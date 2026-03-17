from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.chat_history.schema import ChatHistoryItemOut, ChatHistoryListOut
from src.web.chat.models import (
    ChatMessageRecord,
    ChatPackageSnapshotRecord,
    ChatPlanItemRecord,
    ChatPlanRecord,
    ChatSessionRecord,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _preview_text(last_user_message: str | None, last_assistant_message: str | None) -> str:
    base = (last_user_message or last_assistant_message or "").strip()
    if not base:
      return "Start a new buying brief"
    return base[:120]


def _session_title_from_message(message: str) -> str:
    compact = " ".join(message.split()).strip()
    if not compact:
        return "New workspace"
    return compact[:72]


async def create_chat_session(session: AsyncSession, user_id: UUID, session_id: str) -> None:
    row = ChatSessionRecord(
        id=session_id,
        user_id=user_id,
        title="New workspace",
        status="draft",
        last_activity_at=_now(),
    )
    session.add(row)
    await session.commit()


async def get_chat_session_row(
    session: AsyncSession,
    user_id: UUID,
    session_id: str,
) -> ChatSessionRecord | None:
    return await session.scalar(
        select(ChatSessionRecord).where(ChatSessionRecord.id == session_id, ChatSessionRecord.user_id == user_id)
    )


async def append_user_message(
    session: AsyncSession,
    *,
    user_id: UUID,
    session_id: str,
    message_id: str,
    content: str,
) -> None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        raise ValueError("Chat session not found.")

    next_index = (
        await session.scalar(
            select(ChatMessageRecord.sequence_index)
            .where(ChatMessageRecord.session_id == session_id)
            .order_by(ChatMessageRecord.sequence_index.desc())
            .limit(1)
        )
    ) or 0

    session.add(
        ChatMessageRecord(
            id=message_id,
            session_id=session_id,
            user_id=user_id,
            role="user",
            content=content,
            sequence_index=int(next_index) + 1,
        )
    )
    session_row.title = _session_title_from_message(content)
    session_row.last_user_message = content
    session_row.status = "running"
    session_row.last_activity_at = _now()
    await session.commit()


async def persist_assistant_message(
    session: AsyncSession,
    *,
    user_id: UUID,
    session_id: str,
    message_id: str,
    content: str,
    package_snapshot_id: str | None = None,
) -> None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        return

    next_index = (
        await session.scalar(
            select(ChatMessageRecord.sequence_index)
            .where(ChatMessageRecord.session_id == session_id)
            .order_by(ChatMessageRecord.sequence_index.desc())
            .limit(1)
        )
    ) or 0

    session.add(
        ChatMessageRecord(
            id=message_id,
            session_id=session_id,
            user_id=user_id,
            role="assistant",
            content=content,
            sequence_index=int(next_index) + 1,
        )
    )
    if package_snapshot_id:
        snapshot_row = await session.scalar(
            select(ChatPackageSnapshotRecord).where(
                ChatPackageSnapshotRecord.id == package_snapshot_id,
                ChatPackageSnapshotRecord.user_id == user_id,
                ChatPackageSnapshotRecord.session_id == session_id,
            )
        )
        if snapshot_row is not None:
            snapshot_row.message_id = message_id
    session_row.last_assistant_message = content
    session_row.last_activity_at = _now()
    await session.commit()


async def persist_package_snapshot(
    session: AsyncSession,
    *,
    user_id: UUID,
    session_id: str,
    snapshot_id: str,
    plans: list[dict[str, Any]],
) -> None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        return

    session.add(
        ChatPackageSnapshotRecord(
            id=snapshot_id,
            session_id=session_id,
            user_id=user_id,
            plans_json=plans,
        )
    )
    session_row.last_activity_at = _now()
    await session.commit()


async def replace_session_plans(
    session: AsyncSession,
    *,
    user_id: UUID,
    session_id: str,
    plans: list[dict[str, Any]],
) -> None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        return

    existing_plan_ids = (
        await session.scalars(select(ChatPlanRecord.id).where(ChatPlanRecord.session_id == session_id))
    ).all()
    plan_ids = list(existing_plan_ids)
    if plan_ids:
        await session.execute(delete(ChatPlanItemRecord).where(ChatPlanItemRecord.plan_id.in_(plan_ids)))
        await session.execute(delete(ChatPlanRecord).where(ChatPlanRecord.id.in_(plan_ids)))

    plan_rows: list[ChatPlanRecord] = []
    for plan_index, plan in enumerate(plans):
        plan_rows.append(
            ChatPlanRecord(
                id=str(plan["id"]),
                session_id=session_id,
                user_id=user_id,
                title=str(plan["title"]),
                summary=str(plan["summary"]),
                explanation=str(plan.get("explanation") or ""),
                total_price=float(plan["totalPrice"]),
                confidence=float(plan["confidence"]),
                position=plan_index,
            ),
        )

    session.add_all(plan_rows)
    await session.flush()

    for plan in plans:
        for item_index, item in enumerate(plan.get("items", [])):
            session.add(
                ChatPlanItemRecord(
                    plan_id=str(plan["id"]),
                    sku=str(item["sku"]),
                    title=str(item["title"]),
                    price=float(item["price"]),
                    reason=str(item["reason"]),
                    image_url=item.get("imageUrl"),
                    product_url=item.get("productUrl"),
                    description=item.get("description"),
                    category_label=item.get("categoryLabel"),
                    specs=item.get("specs"),
                    position=item_index,
                )
            )

    session_row.active_plan_id = str(plans[0]["id"]) if plans else None
    session_row.status = "completed" if plans else session_row.status
    session_row.last_activity_at = _now()
    await session.commit()


async def mark_session_failed(session: AsyncSession, user_id: UUID, session_id: str) -> None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        return
    session_row.status = "failed"
    session_row.last_activity_at = _now()
    await session.commit()


async def load_chat_history(session: AsyncSession, user_id: UUID) -> ChatHistoryListOut:
    rows = (
        await session.scalars(
            select(ChatSessionRecord)
            .where(ChatSessionRecord.user_id == user_id)
            .order_by(ChatSessionRecord.last_activity_at.desc(), ChatSessionRecord.created_at.desc())
            .limit(30)
        )
    ).all()

    return ChatHistoryListOut(
        sessions=[
            ChatHistoryItemOut(
                session_id=row.id,
                title=row.title or "New workspace",
                preview=_preview_text(row.last_user_message, row.last_assistant_message),
                updated_at=row.last_activity_at.isoformat(),
            )
            for row in rows
        ]
    )


async def load_chat_session_dump(
    session: AsyncSession,
    user_id: UUID,
    session_id: str,
) -> dict[str, Any] | None:
    session_row = await get_chat_session_row(session, user_id, session_id)
    if session_row is None:
        return None

    message_rows = (
        await session.scalars(
            select(ChatMessageRecord)
            .where(ChatMessageRecord.session_id == session_id)
            .order_by(ChatMessageRecord.sequence_index.asc())
        )
    ).all()
    plan_rows = (
        await session.scalars(
            select(ChatPlanRecord)
            .where(ChatPlanRecord.session_id == session_id)
            .order_by(ChatPlanRecord.position.asc())
        )
    ).all()
    snapshot_rows = (
        await session.scalars(
            select(ChatPackageSnapshotRecord)
            .where(ChatPackageSnapshotRecord.session_id == session_id)
            .order_by(ChatPackageSnapshotRecord.created_at.asc())
        )
    ).all()

    plans: list[dict[str, Any]] = []
    for plan_row in plan_rows:
        item_rows = (
            await session.scalars(
                select(ChatPlanItemRecord)
                .where(ChatPlanItemRecord.plan_id == plan_row.id)
                .order_by(ChatPlanItemRecord.position.asc())
            )
        ).all()
        plans.append(
            {
                "id": plan_row.id,
                "title": plan_row.title,
                "summary": plan_row.summary,
                "explanation": plan_row.explanation or "",
                "totalPrice": plan_row.total_price,
                "confidence": plan_row.confidence,
                "items": [
                    {
                        "sku": item.sku,
                        "title": item.title,
                        "price": item.price,
                        "reason": item.reason,
                        "imageUrl": item.image_url,
                        "productUrl": item.product_url,
                        "description": item.description,
                        "categoryLabel": item.category_label,
                        "specs": item.specs,
                    }
                    for item in item_rows
                ],
            }
        )

    snapshot_message_map = {
        snapshot.message_id: snapshot.id for snapshot in snapshot_rows if snapshot.message_id
    }

    return {
        "session_id": session_id,
        "messages": [
            {
                "id": row.id,
                "role": row.role,
                "content": row.content,
                "createdAt": row.created_at.isoformat(),
                "packageSnapshotId": snapshot_message_map.get(row.id),
            }
            for row in message_rows
        ],
        "timeline": [],
        "plans": plans,
        "packageSnapshots": {snapshot.id: snapshot.plans_json for snapshot in snapshot_rows},
        "title": session_row.title or "New workspace",
    }
