import secrets
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi_users.exceptions import UserAlreadyExists
from fastapi_users.router.oauth import (
    CSRF_TOKEN_COOKIE_NAME,
    CSRF_TOKEN_KEY,
    STATE_TOKEN_AUDIENCE,
    ErrorCode,
    OAuth2AuthorizeCallback,
    decode_jwt,
    generate_csrf_token,
    generate_state_token,
)

from .auth_backend import auth_backend
from .config import settings
from .oauth import google_oauth_client
from .users import get_user_manager


router = APIRouter()
callback_route_name = "google-oauth-callback"
oauth2_authorize_callback = OAuth2AuthorizeCallback(
    google_oauth_client,
    route_name=callback_route_name,
)


def _build_frontend_redirect(**params: str) -> str:
    fragment = urlencode(params)
    return f"{settings.google_oauth_frontend_redirect_url}#{fragment}"


def _error_value(error: ErrorCode | str) -> str:
    return error.value if isinstance(error, ErrorCode) else str(error)


@router.get("/authorize", tags=["auth"])
async def google_authorize(request: Request, response: Response) -> dict[str, str]:
    csrf_token = generate_csrf_token()
    state = generate_state_token({CSRF_TOKEN_KEY: csrf_token}, settings.oauth_state_secret)
    authorization_url = await google_oauth_client.get_authorization_url(
        str(request.url_for(callback_route_name)),
        state,
    )
    response.set_cookie(
        CSRF_TOKEN_COOKIE_NAME,
        csrf_token,
        max_age=3600,
        path="/",
        secure=settings.oauth_csrf_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return {"authorization_url": authorization_url}


@router.get("/callback", name=callback_route_name, tags=["auth"])
async def google_callback(
    request: Request,
    access_token_state=Depends(oauth2_authorize_callback),
    user_manager=Depends(get_user_manager),
    strategy=Depends(auth_backend.get_strategy),
) -> RedirectResponse:
    token, state = access_token_state

    try:
        state_data = decode_jwt(state, settings.oauth_state_secret, [STATE_TOKEN_AUDIENCE])
        cookie_csrf_token = request.cookies.get(CSRF_TOKEN_COOKIE_NAME)
        state_csrf_token = state_data.get(CSRF_TOKEN_KEY)
        if (
            not cookie_csrf_token
            or not state_csrf_token
            or not secrets.compare_digest(cookie_csrf_token, state_csrf_token)
        ):
            raise ValueError(ErrorCode.OAUTH_INVALID_STATE)

        account_id, account_email = await google_oauth_client.get_id_email(token["access_token"])
        if account_email is None:
            raise ValueError(ErrorCode.OAUTH_NOT_AVAILABLE_EMAIL)

        user = await user_manager.oauth_callback(
            google_oauth_client.name,
            token["access_token"],
            account_id,
            account_email,
            token.get("expires_at"),
            token.get("refresh_token"),
            request,
            associate_by_email=True,
            is_verified_by_default=True,
        )
        if not user.is_active:
            raise ValueError(ErrorCode.LOGIN_BAD_CREDENTIALS)

        access_token = await strategy.write_token(user)
        redirect = RedirectResponse(
            url=_build_frontend_redirect(access_token=access_token, token_type="bearer"),
            status_code=status.HTTP_302_FOUND,
        )
        await user_manager.on_after_login(user, request, redirect)
        redirect.delete_cookie(CSRF_TOKEN_COOKIE_NAME, path="/")
        return redirect
    except jwt.DecodeError:
        error = ErrorCode.ACCESS_TOKEN_DECODE_ERROR
    except jwt.ExpiredSignatureError:
        error = ErrorCode.ACCESS_TOKEN_ALREADY_EXPIRED
    except UserAlreadyExists:
        error = ErrorCode.OAUTH_USER_ALREADY_EXISTS
    except ValueError as exc:
        error = exc.args[0]

    redirect = RedirectResponse(
        url=_build_frontend_redirect(error=_error_value(error)),
        status_code=status.HTTP_302_FOUND,
    )
    redirect.delete_cookie(CSRF_TOKEN_COOKIE_NAME, path="/")
    return redirect
