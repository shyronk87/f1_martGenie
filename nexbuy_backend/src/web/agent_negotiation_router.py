from fastapi import APIRouter, Depends, HTTPException

from src.buy_agent.schema import BuyerAgentRunIn, BuyerAgentRunResult
from src.buy_agent.service import run_buyer_negotiation
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/agent-negotiation", tags=["buy_agent"])


@router.post("/run", response_model=BuyerAgentRunResult)
async def run_agent_negotiation(
    payload: BuyerAgentRunIn,
    user: User = Depends(CurrentActiveUser),
) -> BuyerAgentRunResult:
    try:
        return await run_buyer_negotiation(
            user_id=str(user.id),
            sku_id_default=payload.sku_id_default,
            target_price=payload.target_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
