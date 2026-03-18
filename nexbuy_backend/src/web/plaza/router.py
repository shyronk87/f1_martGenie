import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.plaza import (
    AgentShowcaseCreateIn,
    AgentShowcaseDetail,
    AgentShowcaseMockSeedOut,
    AgentShowcaseSummary,
    MartGennieFeedbackCreateIn,
    MartGennieFeedbackItem,
    MartGennieFeedbackListOut,
    PlazaRecommendationsOut,
)
from src.plaza.service import (
    delete_feedback,
    create_feedback,
    create_mock_showcases,
    create_showcase,
    get_memory_recommendations,
    get_showcase_detail,
    list_feedback,
    list_showcases,
)
from src.web.auth.db import get_async_session
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/plaza", tags=["plaza"])


@router.get("/showcase", response_model=list[AgentShowcaseSummary])
async def fetch_showcases(
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
) -> list[AgentShowcaseSummary]:
    return await list_showcases(session, limit=limit)


@router.get("/showcase/{showcase_id}", response_model=AgentShowcaseDetail)
async def fetch_showcase_detail(
    showcase_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
) -> AgentShowcaseDetail:
    detail = await get_showcase_detail(session, showcase_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Showcase record not found.")
    return detail


@router.post("/showcase", response_model=AgentShowcaseDetail, status_code=201)
async def create_showcase_record(
    payload: AgentShowcaseCreateIn,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> AgentShowcaseDetail:
    try:
        detail = await create_showcase(session, user=user, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return detail


@router.post("/showcase/mock/seed", response_model=AgentShowcaseMockSeedOut, status_code=201)
async def seed_mock_showcases(
    session: AsyncSession = Depends(get_async_session),
) -> AgentShowcaseMockSeedOut:
    try:
        created_count = await create_mock_showcases(session)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    total_count = len(await list_showcases(session, limit=100))
    return AgentShowcaseMockSeedOut(created_count=created_count, total_count=total_count)


@router.get("/recommendations/me", response_model=PlazaRecommendationsOut)
async def fetch_memory_recommendations(
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> PlazaRecommendationsOut:
    return await get_memory_recommendations(session, user=user)


@router.get("/feedback", response_model=MartGennieFeedbackListOut)
async def fetch_feedback(
    limit: int = Query(default=9, ge=1, le=24),
    session: AsyncSession = Depends(get_async_session),
) -> MartGennieFeedbackListOut:
    return await list_feedback(session, limit=limit)


@router.post("/feedback", response_model=MartGennieFeedbackItem, status_code=201)
async def create_feedback_record(
    payload: MartGennieFeedbackCreateIn,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> MartGennieFeedbackItem:
    return await create_feedback(session, user=user, payload=payload)


@router.delete("/feedback/{feedback_id}", status_code=204)
async def delete_feedback_record(
    feedback_id: uuid.UUID,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    try:
        await delete_feedback(session, feedback_id=feedback_id, user=user)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
