import secrets
import time
import json
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi_users.exceptions import UserAlreadyExists
from fastapi_users.router.oauth import (
    CSRF_TOKEN_COOKIE_NAME,
    CSRF_TOKEN_KEY,
    STATE_TOKEN_AUDIENCE,
    ErrorCode,
    decode_jwt,
    generate_csrf_token,
    generate_state_token,
)
from jwt.algorithms import RSAAlgorithm

from .auth_backend import auth_backend
from .config import settings
from .session_tokens import generate_refresh_token, set_refresh_cookie
from .users import get_user_manager


APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"

router = APIRouter()
callback_route_name = "apple-oauth-callback"


def _build_frontend_redirect(**params: str) -> str:
    fragment = urlencode(params)
    return f"{settings.apple_oauth_frontend_redirect_url}#{fragment}"


def _error_value(error: ErrorCode | str) -> str:
    return error.value if isinstance(error, ErrorCode) else str(error)


def _apple_private_key() -> str:
    return settings.apple_oauth_private_key.replace("\\n", "\n")


def _build_apple_client_secret() -> str:
    now = int(time.time())
    payload = {
        "iss": settings.apple_oauth_team_id,
        "iat": now,
        "exp": now + 86400 * 180,
        "aud": "https://appleid.apple.com",
        "sub": settings.apple_oauth_client_id,
    }
    headers = {"kid": settings.apple_oauth_key_id}
    return jwt.encode(payload, _apple_private_key(), algorithm="ES256", headers=headers)


async def _exchange_code_for_token(code: str) -> dict:
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": settings.apple_oauth_redirect_uri,
        "client_id": settings.apple_oauth_client_id,
        "client_secret": _build_apple_client_secret(),
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(APPLE_TOKEN_URL, data=data, headers=headers)
    if response.status_code >= 400:
        raise ValueError(f"APPLE_TOKEN_EXCHANGE_FAILED:{response.status_code}")
    return response.json()


async def _decode_and_verify_id_token(id_token: str) -> dict:
    unverified_header = jwt.get_unverified_header(id_token)
    kid = unverified_header.get("kid")
    if not kid:
        raise ValueError("APPLE_ID_TOKEN_HEADER_INVALID")

    async with httpx.AsyncClient(timeout=20) as client:
        keys_response = await client.get(APPLE_KEYS_URL)
    if keys_response.status_code >= 400:
        raise ValueError("APPLE_KEYS_FETCH_FAILED")

    keys = keys_response.json().get("keys", [])
    matching_key = next((key for key in keys if key.get("kid") == kid), None)
    if matching_key is None:
        raise ValueError("APPLE_SIGNING_KEY_NOT_FOUND")

    public_key = RSAAlgorithm.from_jwk(json.dumps(matching_key))
    claims = jwt.decode(
        id_token,
        key=public_key,
        algorithms=["RS256"],
        audience=settings.apple_oauth_client_id,
        issuer="https://appleid.apple.com",
    )
    return claims


@router.get("/authorize", tags=["auth"])
async def apple_authorize(response: Response) -> dict[str, str]:
    if not all(
        [
            settings.apple_oauth_client_id,
            settings.apple_oauth_team_id,
            settings.apple_oauth_key_id,
            settings.apple_oauth_private_key,
            settings.apple_oauth_redirect_uri,
        ]
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="APPLE_OAUTH_NOT_CONFIGURED",
        )

    csrf_token = generate_csrf_token()
    state = generate_state_token({CSRF_TOKEN_KEY: csrf_token}, settings.oauth_state_secret)
    params = {
        "response_type": "code",
        "response_mode": settings.apple_oauth_response_mode,
        "client_id": settings.apple_oauth_client_id,
        "redirect_uri": settings.apple_oauth_redirect_uri,
        "scope": settings.apple_oauth_scope,
        "state": state,
    }
    authorization_url = f"{APPLE_AUTHORIZE_URL}?{urlencode(params)}"

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


@router.api_route("/callback", methods=["GET", "POST"], name=callback_route_name, tags=["auth"])
async def apple_callback(
    request: Request,
    user_manager=Depends(get_user_manager),
    strategy=Depends(auth_backend.get_strategy),
) -> RedirectResponse:
    try:
        if request.method == "POST":
            payload = await request.form()
            code = payload.get("code")
            state = payload.get("state")
        else:
            code = request.query_params.get("code")
            state = request.query_params.get("state")

        if not code or not state:
            raise ValueError(ErrorCode.OAUTH_CALLBACK_ERROR)

        state_data = decode_jwt(state, settings.oauth_state_secret, [STATE_TOKEN_AUDIENCE])
        cookie_csrf_token = request.cookies.get(CSRF_TOKEN_COOKIE_NAME)
        state_csrf_token = state_data.get(CSRF_TOKEN_KEY)
        if (
            not cookie_csrf_token
            or not state_csrf_token
            or not secrets.compare_digest(cookie_csrf_token, state_csrf_token)
        ):
            raise ValueError(ErrorCode.OAUTH_INVALID_STATE)

        token = await _exchange_code_for_token(str(code))
        id_token = token.get("id_token")
        if not id_token:
            raise ValueError(ErrorCode.OAUTH_CALLBACK_ERROR)

        claims = await _decode_and_verify_id_token(str(id_token))
        account_id = claims.get("sub")
        account_email = claims.get("email")
        if not account_id:
            raise ValueError(ErrorCode.OAUTH_CALLBACK_ERROR)
        expires_in = token.get("expires_in")
        expires_at = int(time.time()) + int(expires_in) if expires_in else None

        user = await user_manager.oauth_callback(
            "apple",
            token.get("access_token", ""),
            str(account_id),
            str(account_email) if account_email else None,
            expires_at,
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
        set_refresh_cookie(redirect, generate_refresh_token(user))
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
