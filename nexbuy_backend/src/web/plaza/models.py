import uuid
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.web.auth.models import Base


class AgentShowcaseRecord(Base):
    __tablename__ = "agent_showcase"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    user_display_masked: Mapped[str] = mapped_column(String(255), nullable=False)
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    bundle_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency_symbol: Mapped[str] = mapped_column(String(8), nullable=False, default="$")
    total_original_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    total_final_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    total_saved_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    cover_sku_id_default: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_chat_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_negotiation_session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    approved_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class AgentShowcaseItemRecord(Base):
    __tablename__ = "agent_showcase_item"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    showcase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_showcase.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sku_id_default: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    original_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    sale_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    final_price_used: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    saved_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class MartGennieFeedbackRecord(Base):
    __tablename__ = "martgennie_feedback"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    user_display_masked: Mapped[str] = mapped_column(String(255), nullable=False)
    feedback_text: Mapped[str] = mapped_column(Text, nullable=False)
    context_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    outcome_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    used_negotiation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    saved_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[Any] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
