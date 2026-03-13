import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.profile.schema import UserAddressListResponse, UserAddressPayload
from src.profile.service import create_address, list_addresses, set_default_address, update_address
from src.web.auth.db import get_async_session
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("/addresses", response_model=UserAddressListResponse)
async def get_profile_addresses(
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> UserAddressListResponse:
    return await list_addresses(session, user.id)


@router.post("/addresses", response_model=UserAddressListResponse)
async def post_profile_address(
    payload: UserAddressPayload,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> UserAddressListResponse:
    try:
        return await create_address(session, user.id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/addresses/{address_id}", response_model=UserAddressListResponse)
async def put_profile_address(
    address_id: uuid.UUID,
    payload: UserAddressPayload,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> UserAddressListResponse:
    try:
        return await update_address(session, user.id, address_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/addresses/{address_id}/default", response_model=UserAddressListResponse)
async def post_default_profile_address(
    address_id: uuid.UUID,
    user: User = Depends(CurrentActiveUser),
    session: AsyncSession = Depends(get_async_session),
) -> UserAddressListResponse:
    try:
        return await set_default_address(session, user.id, address_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
