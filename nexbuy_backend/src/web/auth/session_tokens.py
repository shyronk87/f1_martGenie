import jwt
from fastapi import Response, status
from fastapi_users import models
from fastapi_users.jwt import decode_jwt, generate_jwt

from .config import settings


REFRESH_TOKEN_AUDIENCE = ["martgennie:refresh"]


def _refresh_secret() -> str:
    secret = settings.refresh_token_secret.strip()
    return secret or settings.jwt_secret


def generate_refresh_token(user: models.UP) -> str:
    return generate_jwt(
        {"sub": str(user.id), "aud": REFRESH_TOKEN_AUDIENCE},
        _refresh_secret(),
        settings.refresh_token_lifetime_seconds,
        algorithm="HS256",
    )


def decode_refresh_token(token: str) -> dict:
    return decode_jwt(token, _refresh_secret(), REFRESH_TOKEN_AUDIENCE, algorithms=["HS256"])


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        settings.refresh_cookie_name,
        refresh_token,
        max_age=settings.refresh_token_lifetime_seconds,
        path="/",
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        settings.refresh_cookie_name,
        path="/",
    )


def is_refresh_token_invalid(error: Exception) -> bool:
    return isinstance(error, (jwt.DecodeError, jwt.ExpiredSignatureError, jwt.InvalidTokenError))


def unauthorized_session_error(detail: str = "SESSION_EXPIRED") -> Exception:
    from fastapi import HTTPException

    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)
