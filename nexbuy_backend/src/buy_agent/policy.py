from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from src.sell_agent.schema import NegotiationTurn


MAX_ROUNDS = 5


@dataclass
class BuyerConstraints:
    target_price: float
    max_acceptable_price: float
    list_price: float
    max_rounds: int = MAX_ROUNDS


@dataclass
class BuyerDecision:
    action: Literal["offer", "accept_seller_price", "walk_away"]
    buyer_offer: float | None
    rationale: str


def derive_max_acceptable_price(target_price: float, list_price: float) -> float:
    # Allow a modest premium over target so the buyer agent can still close realistic deals.
    premium_cap = max(target_price * 1.12, target_price + 40.0)
    return round(min(list_price, premium_cap), 2)


def choose_opening_offer(constraints: BuyerConstraints) -> BuyerDecision:
    opening_offer = max(1.0, min(constraints.target_price * 0.92, constraints.max_acceptable_price))
    return BuyerDecision(
        action="offer",
        buyer_offer=round(opening_offer, 2),
        rationale=(
            "Start slightly below the target price to test the seller's flexibility without making "
            "an unserious opening offer."
        ),
    )


def decide_next_action(
    constraints: BuyerConstraints,
    *,
    seller_turn: NegotiationTurn,
    completed_rounds: int,
) -> BuyerDecision:
    seller_price = float(seller_turn.seller_counter_price or seller_turn.current_target_price or 0)
    buyer_offer = float(seller_turn.buyer_offer or 0)
    rounds_left = max(constraints.max_rounds - completed_rounds, 0)

    if seller_turn.seller_decision == "accept":
        return BuyerDecision(
            action="accept_seller_price",
            buyer_offer=seller_price,
            rationale="The seller has accepted a price that is within the buyer's allowed range.",
        )

    if seller_price <= constraints.target_price:
        return BuyerDecision(
            action="accept_seller_price",
            buyer_offer=seller_price,
            rationale="The seller counter is already at or below the target price, so there is no reason to prolong negotiation.",
        )

    if seller_price > constraints.max_acceptable_price and rounds_left <= 1:
        return BuyerDecision(
            action="walk_away",
            buyer_offer=None,
            rationale="The seller is still above the buyer's ceiling and no meaningful rounds remain.",
        )

    if seller_price > constraints.max_acceptable_price:
        next_offer = min(constraints.max_acceptable_price, max(buyer_offer, constraints.target_price * 0.98))
        return BuyerDecision(
            action="offer",
            buyer_offer=round(next_offer, 2),
            rationale="Move closer to the ceiling once to test whether the seller will meet the buyer near the acceptable boundary.",
        )

    midpoint = (seller_price + constraints.target_price) / 2.0
    if rounds_left <= 1:
        final_offer = min(seller_price, constraints.max_acceptable_price)
        return BuyerDecision(
            action="accept_seller_price" if final_offer == seller_price else "offer",
            buyer_offer=round(final_offer, 2),
            rationale="Use the final round decisively instead of making another small incremental move.",
        )

    next_offer = min(constraints.max_acceptable_price, max(midpoint, buyer_offer + 10.0))
    return BuyerDecision(
        action="offer",
        buyer_offer=round(next_offer, 2),
        rationale="Increase in controlled steps to preserve bargaining room while signaling real purchase intent.",
    )
