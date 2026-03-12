import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.model.memory import get_profile
from src.model.query_data.db import query_products
from src.model.query_data.schema import QueryFilters
from src.web.auth.models import User
from src.web.plaza.models import AgentShowcaseItemRecord, AgentShowcaseRecord

from .schema import (
    AgentShowcaseCreateIn,
    AgentShowcaseDetail,
    AgentShowcaseItem,
    AgentShowcaseSummary,
    PlazaRecommendationProduct,
    PlazaRecommendationsOut,
)


MOCK_AGENT_PROFILES = [
    {"shopper_name": "Bob", "agent_name": "Bob's Agent", "badge": "Package Done"},
    {"shopper_name": "David", "agent_name": "David's Agent", "badge": "Savings"},
    {"shopper_name": "Alice", "agent_name": "Alice's Agent", "badge": "Savings"},
    {"shopper_name": "Emma", "agent_name": "Emma's Agent", "badge": "Package Done"},
    {"shopper_name": "Carol", "agent_name": "Carol's Agent", "badge": "Deal Found"},
    {"shopper_name": "Mia", "agent_name": "Mia's Agent", "badge": "Savings"},
]


def _money(value: float | Decimal | None) -> float:
    if value is None:
        return 0.0
    return round(float(value), 2)


def _mask_user_display(user: User) -> str:
    email = getattr(user, "email", None)
    if isinstance(email, str) and "@" in email:
        local, domain = email.split("@", 1)
        visible = local[:2] if len(local) >= 2 else local[:1]
        return f"{visible}***@{domain}"
    return f"User-{str(user.id)[:6]}"


def _headline(display_name: str, saved_amount: float, currency_symbol: str) -> str:
    return f"Agent 帮 {display_name} 节省了 {currency_symbol}{saved_amount:.2f}"


def _shopper_headline(shopper_name: str, saved_amount: float, currency_symbol: str) -> str:
    return f"Agent saved {currency_symbol}{saved_amount:.2f} for {shopper_name}"


def _sentence_case(value: str | None) -> str:
    if not value:
        return "bundle"
    text_value = value.strip()
    return text_value[:1].upper() + text_value[1:]


def _dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(normalized)
    return out


def _memory_summary_from_profile(profile: Any) -> str:
    parts: list[str] = []
    if profile.style_preferences:
        parts.append(f"Style: {', '.join(profile.style_preferences[:2])}")
    if profile.room_priorities:
        parts.append(f"Room: {', '.join(profile.room_priorities[:2])}")
    if profile.household_members:
        parts.append(f"Household: {', '.join(profile.household_members[:2])}")
    if profile.price_philosophy:
        parts.append(f"Budget: {profile.price_philosophy}")
    return " | ".join(parts) if parts else "Recommendations based on your saved preferences."


def _reason_tags_from_profile(profile: Any) -> list[str]:
    tags: list[str] = []
    tags.extend(profile.style_preferences[:2])
    tags.extend(profile.room_priorities[:2])
    tags.extend(profile.household_members[:2])
    if profile.price_philosophy:
        tags.append(profile.price_philosophy)
    return _dedupe_keep_order(tags)


def _build_recommendation_filters(profile: Any) -> QueryFilters:
    style_keywords = list(profile.style_preferences or [])
    room_keywords = list(profile.room_priorities or [])
    constraint_keywords = list(profile.negative_constraints or [])
    item_categories = list(profile.function_preferences or [])

    if any(member.lower() in {"cat", "dog"} for member in profile.household_members or []):
        constraint_keywords.extend(["easy clean", "durable", "scratch"])
    if any(member.lower() == "toddler" for member in profile.household_members or []):
        constraint_keywords.extend(["rounded", "safe"])
    if any(member.lower() == "senior" for member in profile.household_members or []):
        item_categories.extend(["comfort", "support"])

    max_budget: float | None = None
    philosophy = (profile.price_philosophy or "").lower()
    if philosophy == "value":
        max_budget = 800
    elif philosophy == "balanced":
        max_budget = 1800
    elif philosophy == "premium":
        max_budget = 3200

    query_text_parts: list[str] = []
    query_text_parts.extend(style_keywords[:2])
    query_text_parts.extend(room_keywords[:2])
    query_text_parts.extend(item_categories[:2])

    return QueryFilters(
        query_text=" ".join(query_text_parts),
        final_limit=8,
        limit=8,
        vector_top_k=1,
        semantic_weight=0.0,
        keyword_weight=1.0,
        max_budget=max_budget,
        style_keywords=_dedupe_keep_order(style_keywords),
        room_keywords=_dedupe_keep_order(room_keywords),
        item_categories=_dedupe_keep_order(item_categories),
        constraint_keywords=_dedupe_keep_order(constraint_keywords),
    )


def _build_product_reason(product: Any, profile: Any) -> tuple[str, list[str]]:
    tags: list[str] = []
    searchable = " ".join(
        [
            str(product.title or ""),
            str(product.category_name_1 or ""),
            str(product.category_name_2 or ""),
            str(product.category_name_3 or ""),
            str(product.category_name_4 or ""),
        ]
    ).lower()

    for style in profile.style_preferences or []:
        if style.lower() in searchable:
            tags.append(style)
    for room in profile.room_priorities or []:
        if room.lower() in searchable:
            tags.append(room)

    members = [member.lower() for member in profile.household_members or []]
    if "cat" in members or "dog" in members:
        tags.append("pet-friendly")
    if "toddler" in members:
        tags.append("family-safe")
    if profile.price_philosophy:
        tags.append(profile.price_philosophy)

    tags = _dedupe_keep_order(tags)[:3]
    reason_parts: list[str] = []
    if profile.style_preferences:
        reason_parts.append(f"matches your {profile.style_preferences[0]} taste")
    if profile.room_priorities:
        reason_parts.append(f"fits your {profile.room_priorities[0]} priority")
    if "cat" in members or "dog" in members:
        reason_parts.append("works for a pet-aware home")
    elif "toddler" in members:
        reason_parts.append("leans safer for family use")
    elif profile.price_philosophy:
        reason_parts.append(f"aligns with your {profile.price_philosophy} budget preference")

    if not reason_parts:
        reason_parts.append("fits your saved preference profile")
    return "Recommended because it " + ", ".join(reason_parts[:2]) + ".", tags


async def _fetch_products_by_sku(
    session: AsyncSession,
    sku_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not sku_ids:
        return {}

    stmt = text(
        """
        SELECT
            sku_id_default,
            spu_id,
            title,
            category_name_1,
            category_name_2,
            category_name_3,
            category_name_4,
            main_image_url,
            product_url,
            currency_symbol,
            sale_price,
            original_price
        FROM homary_products
        WHERE sku_id_default = ANY(:sku_ids)
        """
    )
    rows = (await session.execute(stmt, {"sku_ids": sku_ids})).mappings().all()
    return {str(row["sku_id_default"]): dict(row) for row in rows}


async def _fetch_seed_products(
    session: AsyncSession,
    *,
    limit: int = 12,
) -> list[dict[str, Any]]:
    stmt = text(
        """
        SELECT
            sku_id_default,
            spu_id,
            title,
            category_name_1,
            category_name_2,
            category_name_3,
            category_name_4,
            main_image_url,
            product_url,
            currency_symbol,
            sale_price,
            original_price,
            review_count
        FROM homary_products
        WHERE sku_id_default IS NOT NULL
          AND title IS NOT NULL
          AND sale_price IS NOT NULL
        ORDER BY
            review_count DESC NULLS LAST,
            original_price DESC NULLS LAST,
            sale_price DESC NULLS LAST
        LIMIT :limit
        """
    )
    rows = (await session.execute(stmt, {"limit": limit})).mappings().all()
    return [dict(row) for row in rows]


def _summary_query() -> Select[tuple[AgentShowcaseRecord]]:
    return select(AgentShowcaseRecord).where(AgentShowcaseRecord.is_public.is_(True)).order_by(
        AgentShowcaseRecord.approved_at.desc(),
        AgentShowcaseRecord.created_at.desc(),
    )


async def list_showcases(
    session: AsyncSession,
    *,
    limit: int = 20,
) -> list[AgentShowcaseSummary]:
    stmt = _summary_query().limit(limit)
    rows = (await session.scalars(stmt)).all()
    if not rows:
        return []

    cover_skus = [row.cover_sku_id_default for row in rows if row.cover_sku_id_default]
    products = await _fetch_products_by_sku(session, cover_skus)

    return [
        AgentShowcaseSummary(
            id=row.id,
            user_display_masked=row.user_display_masked,
            headline=row.headline,
            summary=row.summary,
            bundle_name=row.bundle_name,
            item_count=row.item_count,
            currency_symbol=row.currency_symbol,
            total_original_price=_money(row.total_original_price),
            total_final_price=_money(row.total_final_price),
            total_saved_amount=_money(row.total_saved_amount),
            cover_sku_id_default=row.cover_sku_id_default,
            cover_image_url=products.get(str(row.cover_sku_id_default), {}).get("main_image_url"),
            approved_at=row.approved_at,
            created_at=row.created_at,
        )
        for row in rows
    ]


async def get_showcase_detail(
    session: AsyncSession,
    showcase_id: uuid.UUID,
) -> AgentShowcaseDetail | None:
    record = await session.get(AgentShowcaseRecord, showcase_id)
    if record is None or not record.is_public:
        return None

    item_stmt = (
        select(AgentShowcaseItemRecord)
        .where(AgentShowcaseItemRecord.showcase_id == showcase_id)
        .order_by(AgentShowcaseItemRecord.sort_order.asc(), AgentShowcaseItemRecord.created_at.asc())
    )
    item_rows = (await session.scalars(item_stmt)).all()
    sku_ids = [row.sku_id_default for row in item_rows]
    product_map = await _fetch_products_by_sku(session, sku_ids)

    items: list[AgentShowcaseItem] = []
    for row in item_rows:
        product = product_map.get(row.sku_id_default)
        if product is None:
            continue
        original_price = _money(row.original_price)
        sale_price = _money(row.sale_price)
        final_price_used = _money(row.final_price_used)
        items.append(
            AgentShowcaseItem(
                sku_id_default=row.sku_id_default,
                spu_id=product.get("spu_id"),
                title=str(product.get("title") or ""),
                category_name_1=product.get("category_name_1"),
                category_name_2=product.get("category_name_2"),
                category_name_3=product.get("category_name_3"),
                category_name_4=product.get("category_name_4"),
                main_image_url=product.get("main_image_url"),
                product_url=product.get("product_url"),
                quantity=row.quantity,
                original_price=original_price,
                sale_price=sale_price,
                final_price_used=final_price_used,
                saved_amount=_money(row.saved_amount),
                sort_order=row.sort_order,
            )
        )

    cover_image_url = product_map.get(str(record.cover_sku_id_default or ""), {}).get("main_image_url")
    return AgentShowcaseDetail(
        id=record.id,
        user_display_masked=record.user_display_masked,
        headline=record.headline,
        summary=record.summary,
        bundle_name=record.bundle_name,
        item_count=record.item_count,
        currency_symbol=record.currency_symbol,
        total_original_price=_money(record.total_original_price),
        total_final_price=_money(record.total_final_price),
        total_saved_amount=_money(record.total_saved_amount),
        cover_sku_id_default=record.cover_sku_id_default,
        cover_image_url=cover_image_url,
        approved_at=record.approved_at,
        created_at=record.created_at,
        items=items,
    )


async def create_showcase(
    session: AsyncSession,
    *,
    user: User,
    payload: AgentShowcaseCreateIn,
) -> AgentShowcaseDetail:
    sku_ids = [item.sku_id_default for item in payload.items]
    product_map = await _fetch_products_by_sku(session, sku_ids)

    missing_skus = [sku for sku in sku_ids if sku not in product_map]
    if missing_skus:
        raise ValueError(f"Unknown sku_id_default: {', '.join(missing_skus)}")

    total_original_price = 0.0
    total_final_price = 0.0
    item_records: list[AgentShowcaseItemRecord] = []

    for item in payload.items:
        product = product_map[item.sku_id_default]
        quantity = int(item.quantity)
        sale_price = _money(product.get("sale_price"))
        original_unit_price = _money(product.get("original_price")) or sale_price
        final_unit_price = _money(item.final_price_used)
        if final_unit_price <= 0:
            final_unit_price = sale_price

        original_total = round(original_unit_price * quantity, 2)
        sale_total = round(sale_price * quantity, 2)
        final_total = round(final_unit_price * quantity, 2)
        saved_amount = round(max(original_total - final_total, 0.0), 2)

        total_original_price += original_total
        total_final_price += final_total

        item_records.append(
            AgentShowcaseItemRecord(
                sku_id_default=item.sku_id_default,
                quantity=quantity,
                sort_order=item.sort_order,
                original_price=original_total,
                sale_price=sale_total,
                final_price_used=final_total,
                saved_amount=saved_amount,
            )
        )

    total_original_price = round(total_original_price, 2)
    total_final_price = round(total_final_price, 2)
    total_saved_amount = round(max(total_original_price - total_final_price, 0.0), 2)
    approved_at = payload.approved_at or datetime.now(timezone.utc)
    cover_sku_id_default = payload.items[0].sku_id_default if payload.items else None
    currency_symbol = str(product_map[cover_sku_id_default].get("currency_symbol") or "$") if cover_sku_id_default else "$"
    display_name = _mask_user_display(user)

    record = AgentShowcaseRecord(
        user_id=user.id,
        user_display_masked=display_name,
        headline=_headline(display_name, total_saved_amount, currency_symbol),
        summary=payload.summary,
        bundle_name=payload.bundle_name,
        item_count=sum(item.quantity for item in payload.items),
        currency_symbol=currency_symbol,
        total_original_price=total_original_price,
        total_final_price=total_final_price,
        total_saved_amount=total_saved_amount,
        cover_sku_id_default=cover_sku_id_default,
        source_chat_session_id=payload.source_chat_session_id,
        source_negotiation_session_id=payload.source_negotiation_session_id,
        approved_at=approved_at,
    )
    session.add(record)
    await session.flush()

    for item_record in item_records:
        item_record.showcase_id = record.id
        session.add(item_record)

    await session.commit()
    return await get_showcase_detail(session, record.id)  # type: ignore[return-value]


async def create_mock_showcases(
    session: AsyncSession,
) -> int:
    existing_count = await session.scalar(
        select(func.count()).select_from(AgentShowcaseRecord).where(AgentShowcaseRecord.is_public.is_(True))
    )
    if int(existing_count or 0) > 0:
        return 0

    products = await _fetch_seed_products(session, limit=18)
    if len(products) < 3:
        raise ValueError("Not enough products in homary_products to seed showcase records.")

    created_count = 0
    group_size = 3
    base_time = datetime.now(timezone.utc)
    for index in range(0, min(len(products), 15), group_size):
        group = products[index : index + group_size]
        if len(group) < group_size:
            break

        profile = MOCK_AGENT_PROFILES[created_count % len(MOCK_AGENT_PROFILES)]
        category = _sentence_case(group[0].get("category_name_2") or group[0].get("category_name_1"))
        item_records: list[AgentShowcaseItemRecord] = []
        total_original_price = 0.0
        total_final_price = 0.0

        for item_index, product in enumerate(group):
            sale_price = _money(product.get("sale_price"))
            original_unit_price = _money(product.get("original_price")) or sale_price
            final_unit_price = round(sale_price * (0.8 + (item_index * 0.05)), 2)
            original_total = round(original_unit_price, 2)
            sale_total = round(sale_price, 2)
            final_total = round(final_unit_price, 2)
            saved_amount = round(max(original_total - final_total, 0.0), 2)

            total_original_price += original_total
            total_final_price += final_total
            item_records.append(
                AgentShowcaseItemRecord(
                    sku_id_default=str(product["sku_id_default"]),
                    quantity=1,
                    sort_order=item_index,
                    original_price=original_total,
                    sale_price=sale_total,
                    final_price_used=final_total,
                    saved_amount=saved_amount,
                )
            )

        total_original_price = round(total_original_price, 2)
        total_final_price = round(total_final_price, 2)
        total_saved_amount = round(max(total_original_price - total_final_price, 0.0), 2)

        record = AgentShowcaseRecord(
            user_id=None,
            user_display_masked=profile["shopper_name"],
            headline=_shopper_headline(profile["shopper_name"], total_saved_amount, "$"),
            summary=(
                f"{profile['agent_name']} put together a {category.lower()} package and closed the bundle "
                f"below the visible list price."
            ),
            bundle_name=f"{category} Collection",
            item_count=len(item_records),
            currency_symbol="$",
            total_original_price=total_original_price,
            total_final_price=total_final_price,
            total_saved_amount=total_saved_amount,
            cover_sku_id_default=str(group[0]["sku_id_default"]),
            source_chat_session_id=f"mock-chat-{created_count + 1}",
            source_negotiation_session_id=f"mock-neg-{created_count + 1}",
            approved_at=base_time.replace(microsecond=0),
        )
        session.add(record)
        await session.flush()

        for item_record in item_records:
            item_record.showcase_id = record.id
            session.add(item_record)

        await session.commit()
        created_count += 1
        base_time = base_time - timedelta(days=3)

    return created_count


async def get_memory_recommendations(
    session: AsyncSession,
    *,
    user: User,
) -> PlazaRecommendationsOut:
    memory_response = await get_profile(session, user.id)
    if memory_response.profile is None:
        return PlazaRecommendationsOut(
            onboarding_required=True,
            memory_summary="Complete your profile to unlock tailored picks.",
            reason_tags=[],
            products=[],
        )

    profile = memory_response.profile
    filters = _build_recommendation_filters(profile)
    products = await query_products(filters)

    recommendation_products: list[PlazaRecommendationProduct] = []
    for product in products:
        reason, matched_tags = _build_product_reason(product, profile)
        recommendation_products.append(
            PlazaRecommendationProduct(
                sku_id_default=product.sku_id_default,
                spu_id=product.spu_id,
                title=product.title,
                category_name_1=product.category_name_1,
                category_name_2=product.category_name_2,
                category_name_3=product.category_name_3,
                category_name_4=product.category_name_4,
                sale_price=_money(product.sale_price),
                original_price=_money(product.original_price),
                stock_status_text=product.stock_status_text,
                main_image_url=product.main_image_url,
                product_url=product.product_url,
                recommendation_reason=reason,
                matched_memory_tags=matched_tags,
            )
        )

    return PlazaRecommendationsOut(
        onboarding_required=False,
        memory_summary=_memory_summary_from_profile(profile),
        reason_tags=_reason_tags_from_profile(profile),
        products=recommendation_products,
    )
