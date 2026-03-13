import uuid
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.web.auth.models import Base


class UserAddress(Base):
    __tablename__ = "user_addresses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    province_state: Mapped[str | None] = mapped_column(String(128), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    district: Mapped[str | None] = mapped_column(String(128), nullable=True)
    street_line_1: Mapped[str | None] = mapped_column(String(255), nullable=True)
    street_line_2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delivery_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
