from fastapi import APIRouter

from .apple_router import router as apple_router
from .auth_backend import auth_backend
from .google_router import router as google_router
from .session_router import router as session_router
from .schemas import UserCreate, UserRead, UserUpdate
from .users import fastapi_users


router = APIRouter()

router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/jwt",
    tags=["auth"],
)
router.include_router(session_router, prefix="/auth/session")
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/auth",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_verify_router(UserRead),
    prefix="/auth",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
router.include_router(google_router, prefix="/auth/google")
router.include_router(apple_router, prefix="/auth/apple")
