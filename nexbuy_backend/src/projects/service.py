from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.projects.schema import ChatProjectCreateIn, ChatProjectItemOut, ChatProjectListOut
from src.web.projects.models import ChatProjectRecord


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_project_id() -> str:
    return f"proj_{uuid4().hex}"


def _to_project_item(record: ChatProjectRecord) -> ChatProjectItemOut:
    return ChatProjectItemOut(
        id=record.id,
        title=record.title,
        summary=record.summary,
        updated_at=record.last_activity_at,
    )


async def ensure_default_project(session: AsyncSession, user_id: UUID) -> ChatProjectRecord:
    existing = await session.scalar(
        select(ChatProjectRecord)
        .where(ChatProjectRecord.user_id == user_id)
        .order_by(ChatProjectRecord.last_activity_at.desc(), ChatProjectRecord.created_at.asc())
        .limit(1)
    )
    if existing is not None:
        return existing

    record = ChatProjectRecord(
        id=_new_project_id(),
        user_id=user_id,
        title="Personal shopping",
        summary="Your main shopping workspace",
        last_activity_at=_now(),
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def list_projects(session: AsyncSession, user_id: UUID) -> ChatProjectListOut:
    await ensure_default_project(session, user_id)
    rows = (
        await session.scalars(
            select(ChatProjectRecord)
            .where(ChatProjectRecord.user_id == user_id)
            .order_by(ChatProjectRecord.last_activity_at.desc(), ChatProjectRecord.created_at.desc())
        )
    ).all()
    return ChatProjectListOut(items=[_to_project_item(row) for row in rows])


async def create_project(
    session: AsyncSession,
    *,
    user_id: UUID,
    payload: ChatProjectCreateIn,
) -> ChatProjectItemOut:
    record = ChatProjectRecord(
        id=_new_project_id(),
        user_id=user_id,
        title=payload.title.strip(),
        summary=payload.summary.strip() if payload.summary else None,
        last_activity_at=_now(),
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return _to_project_item(record)


async def get_project(session: AsyncSession, user_id: UUID, project_id: str) -> ChatProjectRecord | None:
    return await session.scalar(
        select(ChatProjectRecord).where(ChatProjectRecord.id == project_id, ChatProjectRecord.user_id == user_id)
    )


async def touch_project_activity(session: AsyncSession, project_id: str) -> None:
    record = await session.scalar(select(ChatProjectRecord).where(ChatProjectRecord.id == project_id))
    if record is None:
        return
    record.last_activity_at = _now()
