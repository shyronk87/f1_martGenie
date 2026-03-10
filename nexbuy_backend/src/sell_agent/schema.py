from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


DecisionType = Literal["accept", "counter", "reject", "need_offer", "closed"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class NegotiationProduct(BaseModel):
    sku_id_default: str
    title: str = ""
    sale_price: float = 0.0
    mock_urgency_status: str = "NORMAL"
    mock_inventory: int = 0
    mock_min_floor_price: float | None = None


class NegotiationCreateIn(BaseModel):
    sku_id_default: str
    max_rounds: int = Field(default=5, ge=1, le=12)
    buyer_note: str | None = None


class NegotiationOfferIn(BaseModel):
    buyer_offer: float | None = Field(default=None, ge=0)
    buyer_message: str | None = None


class NegotiationTurn(BaseModel):
    round_index: int
    buyer_offer: float | None = None
    seller_decision: DecisionType
    seller_counter_price: float | None = None
    seller_message: str
    current_target_price: float
    min_expected_price: float
    llm_price_verified: bool = True
    llm_verification_note: str | None = None
    final_confirmation: dict[str, str | float | bool] | None = None
    created_at: str = Field(default_factory=now_iso)


class NegotiationSession(BaseModel):
    session_id: str
    user_id: str
    product: NegotiationProduct
    max_rounds: int
    closed: bool = False
    accepted_price: float | None = None
    pricing_params: dict[str, float | int | str] = Field(default_factory=dict)
    turns: list[NegotiationTurn] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
