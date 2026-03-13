import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from src.buy_agent.schema import BuyerAgentCancelResponse, BuyerAgentRunIn, BuyerAgentRunResult
from src.buy_agent.service import cancel_buyer_run, run_buyer_negotiation, stream_buyer_negotiation
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/agent-negotiation", tags=["buy_agent"])


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


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
            max_acceptable_price=payload.max_acceptable_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/run/stream")
async def stream_agent_negotiation(
    payload: BuyerAgentRunIn,
    user: User = Depends(CurrentActiveUser),
) -> StreamingResponse:
    async def event_generator():
        try:
            async for event in stream_buyer_negotiation(
                user_id=str(user.id),
                sku_id_default=payload.sku_id_default,
                target_price=payload.target_price,
                max_acceptable_price=payload.max_acceptable_price,
            ):
                yield _sse(event)
        except ValueError as exc:
            yield _sse({"type": "error", "error": str(exc)})
        except Exception as exc:
            yield _sse({"type": "error", "error": f"Buyer agent stream failed: {exc}"})

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/run/{run_id}/cancel", response_model=BuyerAgentCancelResponse)
async def cancel_agent_negotiation(
    run_id: str,
    user: User = Depends(CurrentActiveUser),
) -> BuyerAgentCancelResponse:
    del user
    cancelled = cancel_buyer_run(run_id)
    return BuyerAgentCancelResponse(
        run_id=run_id,
        cancelled=cancelled,
        message="Cancellation requested." if cancelled else "Run not found or already finished.",
    )
