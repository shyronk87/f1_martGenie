from fastapi import APIRouter, Depends, HTTPException

from src.sell_agent.schema import (
    NegotiationCreateIn,
    NegotiationOfferIn,
    NegotiationSession,
    NegotiationTurn,
)
from src.sell_agent.service import (
    create_negotiation_session,
    ensure_owner,
    get_session,
    submit_buyer_offer,
)
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/negotiation", tags=["sell_agent"])


@router.post("/sessions", response_model=NegotiationSession)
async def create_session(payload: NegotiationCreateIn, user: User = Depends(CurrentActiveUser)) -> NegotiationSession:
    try:
        return await create_negotiation_session(
            user_id=str(user.id),
            sku_id_default=payload.sku_id_default,
            max_rounds=payload.max_rounds,
            buyer_note=payload.buyer_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/sessions/{session_id}", response_model=NegotiationSession)
async def fetch_session(session_id: str, user: User = Depends(CurrentActiveUser)) -> NegotiationSession:
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Negotiation session not found.")
    try:
        ensure_owner(session, str(user.id))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return session


@router.post("/sessions/{session_id}/offer", response_model=NegotiationTurn)
async def submit_offer(
    session_id: str,
    payload: NegotiationOfferIn,
    user: User = Depends(CurrentActiveUser),
) -> NegotiationTurn:
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Negotiation session not found.")
    try:
        ensure_owner(session, str(user.id))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return await submit_buyer_offer(session, payload)
