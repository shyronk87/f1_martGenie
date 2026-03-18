import uuid
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.orm import Mapped, mapped_column

from src.web.auth.models import Base


class ChatProjectRecord(Base):
    __tablename__ = "chat_projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    last_activity_at: Mapped[Any] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


async def ensure_chat_project_schema(connection: AsyncConnection) -> None:
    await connection.execute(
        text(
            "ALTER TABLE chat_sessions "
            "ADD COLUMN IF NOT EXISTS project_id VARCHAR(64) NULL"
        )
    )
    await connection.execute(
        text(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'fk_chat_sessions_project_id'
                ) THEN
                    ALTER TABLE chat_sessions
                    ADD CONSTRAINT fk_chat_sessions_project_id
                    FOREIGN KEY (project_id) REFERENCES chat_projects(id)
                    ON DELETE SET NULL;
                END IF;
            END $$;
            """
        )
    )
