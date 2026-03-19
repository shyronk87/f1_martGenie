from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users import exceptions, models
from fastapi_users.authentication import Strategy
from fastapi_users.manager import BaseUserManager
from pydantic import BaseModel

from .auth_backend import auth_backend
from .config import settings
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
