from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from src.sell_agent.schema import NegotiationSession, NegotiationTurn


BuyerStyle = Literal["balanced"]
BuyerOutcome = Literal["accepted", "walked_away", "seller_closed", "max_rounds_reached"]
BuyerActionType = Literal["offer", "accept_seller_price", "walk_away"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class BuyerAgentRunIn(BaseModel):
    sku_id_default: str
    target_price: float = Field(gt=0)


class BuyerAgentTurn(BaseModel):
    round_index: int
    action: BuyerActionType
    buyer_offer: float | None = None
    buyer_message: str
    rationale: str
    seller_turn: NegotiationTurn | None = None
    created_at: str = Field(default_factory=now_iso)


class BuyerAgentRunResult(BaseModel):
    run_id: str
    user_id: str
    sku_id_default: str
    target_price: float
    max_acceptable_price: float
    max_rounds: int = 5
    style: BuyerStyle = "balanced"
    outcome: BuyerOutcome
    final_price: float | None = None
    summary: str
    seller_session: NegotiationSession
    turns: list[BuyerAgentTurn] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
