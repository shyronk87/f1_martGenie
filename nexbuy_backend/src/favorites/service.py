from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.favorites.schema import (
    FavoriteBundleCreateIn,
    FavoriteBundleItem,
    FavoriteBundleListOut,
    FavoriteProductCreateIn,
    FavoriteProductItem,
    FavoriteProductListOut,
)
from src.web.auth.models import User
from src.web.favorites.models import FavoriteBundleRecord, FavoriteProductRecord


def _to_product_item(record: FavoriteProductRecord) -> FavoriteProductItem:
    return FavoriteProductItem(
        id=record.id,
        sku_id_default=record.sku_id_default,
        title=record.title,
        category_label=record.category_label,
        sale_price=float(record.sale_price) if record.sale_price is not None else None,
        image_url=record.image_url,
        product_url=record.product_url,
        description_text=record.description_text,
        recommendation_reason=record.recommendation_reason,
        specs={str(key): str(value) for key, value in (record.specs or {}).items()},
        source_page=record.source_page,
        created_at=record.created_at,
    )


def _to_bundle_item(record: FavoriteBundleRecord) -> FavoriteBundleItem:
    normalized_items: list[dict[str, object]] = []
    for raw_item in record.items or []:
        if not isinstance(raw_item, dict):
            continue
        normalized_items.append(
            {
                "sku": str(raw_item.get("sku") or ""),
                "title": str(raw_item.get("title") or ""),
                "price": float(raw_item.get("price") or 0),
                "quantity": int(raw_item.get("quantity") or 1),
                "imageUrl": raw_item.get("imageUrl") if isinstance(raw_item.get("imageUrl"), str) else None,
                "categoryLabel": raw_item.get("categoryLabel") if isinstance(raw_item.get("categoryLabel"), str) else None,
            }
        )

    return FavoriteBundleItem(
        id=record.id,
        bundle_id=record.bundle_id,
        title=record.title,
        summary=record.summary,
        total_price=float(record.total_price) if record.total_price is not None else None,
        source_session_id=record.source_session_id,
        source_page=record.source_page,
        items=normalized_items,
        created_at=record.created_at,
    )


def _product_stmt(user: User) -> Select[tuple[FavoriteProductRecord]]:
    return select(FavoriteProductRecord).where(FavoriteProductRecord.user_id == user.id)


def _bundle_stmt(user: User) -> Select[tuple[FavoriteBundleRecord]]:
    return select(FavoriteBundleRecord).where(FavoriteBundleRecord.user_id == user.id)


async def list_favorite_products(session: AsyncSession, user: User) -> FavoriteProductListOut:
    rows = (await session.execute(_product_stmt(user).order_by(FavoriteProductRecord.created_at.desc()))).scalars().all()
    return FavoriteProductListOut(items=[_to_product_item(row) for row in rows])


async def create_favorite_product(
    session: AsyncSession,
    user: User,
    payload: FavoriteProductCreateIn,
) -> FavoriteProductItem:
    existing = (
        await session.execute(
            _product_stmt(user).where(FavoriteProductRecord.sku_id_default == payload.sku_id_default)
        )
    ).scalars().first()

    if existing is None:
        existing = FavoriteProductRecord(user_id=user.id, sku_id_default=payload.sku_id_default, title=payload.title)
        session.add(existing)

    existing.title = payload.title
    existing.category_label = payload.category_label
    existing.sale_price = payload.sale_price
    existing.image_url = payload.image_url
    existing.product_url = payload.product_url
    existing.description_text = payload.description_text
    existing.recommendation_reason = payload.recommendation_reason
    existing.specs = payload.specs
    existing.source_page = payload.source_page

    await session.commit()
    await session.refresh(existing)
    return _to_product_item(existing)


async def delete_favorite_product(session: AsyncSession, user: User, sku_id_default: str) -> None:
    result = await session.execute(
        delete(FavoriteProductRecord).where(
            FavoriteProductRecord.user_id == user.id,
            FavoriteProductRecord.sku_id_default == sku_id_default,
        )
    )
    await session.commit()

    if result.rowcount == 0:
        raise ValueError("Favorite item not found.")


async def list_favorite_bundles(session: AsyncSession, user: User) -> FavoriteBundleListOut:
    rows = (await session.execute(_bundle_stmt(user).order_by(FavoriteBundleRecord.created_at.desc()))).scalars().all()
    return FavoriteBundleListOut(items=[_to_bundle_item(row) for row in rows])


async def create_favorite_bundle(
    session: AsyncSession,
    user: User,
    payload: FavoriteBundleCreateIn,
) -> FavoriteBundleItem:
    existing = (
        await session.execute(_bundle_stmt(user).where(FavoriteBundleRecord.bundle_id == payload.bundle_id))
    ).scalars().first()

    if existing is None:
        existing = FavoriteBundleRecord(user_id=user.id, bundle_id=payload.bundle_id, title=payload.title)
        session.add(existing)

    existing.title = payload.title
    existing.summary = payload.summary
    existing.total_price = payload.total_price
    existing.source_session_id = payload.source_session_id
    existing.source_page = payload.source_page
    existing.items = [item.model_dump() for item in payload.items]

    await session.commit()
    await session.refresh(existing)
    return _to_bundle_item(existing)


async def delete_favorite_bundle(session: AsyncSession, user: User, bundle_id: str) -> None:
    result = await session.execute(
        delete(FavoriteBundleRecord).where(
            FavoriteBundleRecord.user_id == user.id,
            FavoriteBundleRecord.bundle_id == bundle_id,
        )
    )
    await session.commit()

    if result.rowcount == 0:
        raise ValueError("Favorite bundle not found.")
