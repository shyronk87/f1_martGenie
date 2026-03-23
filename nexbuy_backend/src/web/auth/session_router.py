import secrets

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions, models
from fastapi_users.authentication import Strategy
from fastapi_users.manager import BaseUserManager
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth_backend import auth_backend
from .config import settings
from .db import get_async_session
from .models import User
from .session_tokens import (
    clear_refresh_cookie,
    decode_refresh_token,
    generate_refresh_token,
    is_refresh_token_invalid,
    set_refresh_cookie,
    unauthorized_session_error,
)
from .users import get_user_manager


router = APIRouter()


class SessionTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class GuestSessionIn(BaseModel):
    guest_device_id: str = Field(min_length=8, max_length=255)


def _build_guest_email(guest_device_id: str) -> str:
    guest_slug = "".join(char for char in guest_device_id.lower() if char.isalnum())
    guest_slug = guest_slug[:32] or secrets.token_hex(8)
    return f"guest+{guest_slug}@martgennie.smartlpmanager.top"


def _needs_guest_email_repair(user: User) -> bool:
    return bool(user.is_guest and user.email.endswith("@guest.martgennie.local"))


async def _get_or_create_guest_user(
    session: AsyncSession,
    guest_device_id: str,
    user_manager: BaseUserManager[models.UP, models.ID],
) -> User:
    normalized_device_id = guest_device_id.strip()
    existing = await session.scalar(select(User).where(User.guest_device_id == normalized_device_id))
    if existing is not None:
        if _needs_guest_email_repair(existing):
            existing.email = _build_guest_email(normalized_device_id)
            await session.commit()
            await session.refresh(existing)
        return existing

    guest_user = User(
        email=_build_guest_email(normalized_device_id),
        hashed_password=user_manager.password_helper.hash(secrets.token_urlsafe(32)),
        is_active=True,
        is_superuser=False,
        is_verified=True,
        is_guest=True,
        guest_device_id=normalized_device_id,
    )
    session.add(guest_user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(select(User).where(User.guest_device_id == normalized_device_id))
        if existing is not None:
            return existing
        raise
    await session.refresh(guest_user)
    return guest_user


async def _issue_session_response(
    request: Request,
    response: Response,
    user: models.UP,
    strategy: Strategy[models.UP, models.ID],
    user_manager: BaseUserManager[models.UP, models.ID],
) -> SessionTokenOut:
    access_token = await strategy.write_token(user)
    refresh_token = generate_refresh_token(user)
    set_refresh_cookie(response, refresh_token)
    await user_manager.on_after_login(user, request, response)
    return SessionTokenOut(access_token=access_token)


@router.post("/login", response_model=SessionTokenOut, tags=["auth"])
async def session_login(
    request: Request,
    response: Response,
    credentials: OAuth2PasswordRequestForm = Depends(),
    strategy: Strategy[models.UP, models.ID] = Depends(auth_backend.get_strategy),
    user_manager: BaseUserManager[models.UP, models.ID] = Depends(get_user_manager),
) -> SessionTokenOut:
    user = await user_manager.authenticate(credentials)
    if user is None or not user.is_active:
        raise unauthorized_session_error("LOGIN_BAD_CREDENTIALS")

    return await _issue_session_response(request, response, user, strategy, user_manager)


@router.post("/guest", response_model=SessionTokenOut, tags=["auth"])
async def guest_session_login(
    payload: GuestSessionIn,
    request: Request,
    response: Response,
    strategy: Strategy[models.UP, models.ID] = Depends(auth_backend.get_strategy),
    user_manager: BaseUserManager[models.UP, models.ID] = Depends(get_user_manager),
    db_session: AsyncSession = Depends(get_async_session),
) -> SessionTokenOut:
    user = await _get_or_create_guest_user(db_session, payload.guest_device_id, user_manager)
    if not user.is_active:
        raise unauthorized_session_error("LOGIN_BAD_CREDENTIALS")

    return await _issue_session_response(request, response, user, strategy, user_manager)


@router.post("/refresh", response_model=SessionTokenOut, tags=["auth"])
async def refresh_session(
    request: Request,
    response: Response,
    strategy: Strategy[models.UP, models.ID] = Depends(auth_backend.get_strategy),
    user_manager: BaseUserManager[models.UP, models.ID] = Depends(get_user_manager),
) -> SessionTokenOut:
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    if not refresh_token:
        raise unauthorized_session_error()

    try:
        payload = decode_refresh_token(refresh_token)
        user_id = payload.get("sub")
        if user_id is None:
            raise unauthorized_session_error()
        parsed_user_id = user_manager.parse_id(user_id)
        user = await user_manager.get(parsed_user_id)
    except (exceptions.UserNotExists, exceptions.InvalidID):
        raise unauthorized_session_error()
    except Exception as error:
        if is_refresh_token_invalid(error):
            raise unauthorized_session_error()
        raise

    if not user.is_active:
        raise unauthorized_session_error("LOGIN_BAD_CREDENTIALS")

    return await _issue_session_response(request, response, user, strategy, user_manager)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
async def logout_session(response: Response) -> Response:
    clear_refresh_cookie(response)
    return response
