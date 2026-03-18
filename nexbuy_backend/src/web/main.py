from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth.config import settings
from .auth.db import engine
from .auth.models import Base
from .agent_negotiation_router import router as agent_negotiation_router
from .auth.router import router as auth_router
from .chat import models as _chat_models  # noqa: F401
from .chat_router import router as chat_router
from .memory import models as _memory_models  # noqa: F401
from .memory.router import router as memory_router
from .negotiation_router import router as negotiation_router
from .plaza import models as _plaza_models  # noqa: F401
from .plaza.models import ensure_plaza_feedback_schema
from .plaza.router import router as plaza_router
from .profile import models as _profile_models  # noqa: F401
from .profile.router import router as profile_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await ensure_plaza_feedback_schema(connection)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(memory_router, prefix="/api")
app.include_router(negotiation_router, prefix="/api")
app.include_router(agent_negotiation_router, prefix="/api")
app.include_router(plaza_router, prefix="/api")
app.include_router(profile_router, prefix="/api")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok"}
