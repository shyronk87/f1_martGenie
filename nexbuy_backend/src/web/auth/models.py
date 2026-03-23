from fastapi_users_db_sqlalchemy import (
    SQLAlchemyBaseOAuthAccountTableUUID,
    SQLAlchemyBaseUserTableUUID,
)
from sqlalchemy import Boolean, String, text
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import text as sql_text


class Base(DeclarativeBase):
    pass


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    __tablename__ = "oauth_accounts"


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "user"
    is_guest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("FALSE"))
    guest_device_id: Mapped[str | None] = mapped_column(String(length=255), nullable=True, unique=True)
    oauth_accounts: Mapped[list[OAuthAccount]] = relationship("OAuthAccount", lazy="joined")


async def ensure_guest_user_schema(connection: AsyncConnection) -> None:
    await connection.execute(sql_text("ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE"))
    await connection.execute(sql_text("ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS guest_device_id VARCHAR(255)"))
    await connection.execute(
        sql_text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_user_guest_device_id "
            'ON "user" (guest_device_id) WHERE guest_device_id IS NOT NULL'
        )
    )
