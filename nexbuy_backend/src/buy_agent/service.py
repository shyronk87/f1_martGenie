from __future__ import annotations

from uuid import uuid4

from src.sell_agent.schema import NegotiationOfferIn
from src.sell_agent.service import create_negotiation_session, submit_buyer_offer

from .policy import (
    MAX_ROUNDS,
    BuyerConstraints,
    BuyerDecision,
    choose_opening_offer,
    decide_next_action,
    derive_max_acceptable_price,
)
from .schema import BuyerAgentRunResult, BuyerAgentTurn, BuyerOutcome


def _new_run_id() -> str:
    return f"buyer_run_{uuid4().hex}"


def _build_buyer_message(action: BuyerDecision, *, round_index: int) -> str:
    if action.action == "walk_away":
        return (
            "I appreciate the discussion, but I can't justify going higher on this item right now. "
            "I'll pause here unless there's better flexibility."
        )

    if action.action == "accept_seller_price":
        assert action.buyer_offer is not None
        return (
            f"That works for me. If you can confirm ${action.buyer_offer:.2f}, I'm ready to move forward."
        )

    assert action.buyer_offer is not None
    if round_index == 1:
        return (
            f"I'm interested in moving ahead, but I need a better number to make this work. "
            f"Could you do ${action.buyer_offer:.2f}?"
        )
    return (
        f"I can improve my offer a bit from my previous position. "
        f"If you can make ${action.buyer_offer:.2f} work, I can seriously consider closing."
    )


def _build_summary(outcome: str, final_price: float | None, constraints: BuyerConstraints) -> str:
    if outcome == "accepted" and final_price is not None:
        relation = "below" if final_price <= constraints.target_price else "above"
        return (
            f"The buyer agent secured a final price of ${final_price:.2f}, which is {relation} the target "
            f"price of ${constraints.target_price:.2f}."
        )
    if outcome == "walked_away":
        return (
            f"The buyer agent stopped because the seller did not come within the acceptable ceiling of "
            f"${constraints.max_acceptable_price:.2f}."
        )
    if outcome == "seller_closed":
        return "The seller ended the negotiation before a mutually acceptable deal was reached."
    return "The buyer agent used all available rounds without reaching a final agreement."


async def run_buyer_negotiation(*, user_id: str, sku_id_default: str, target_price: float) -> BuyerAgentRunResult:
    seller_session = await create_negotiation_session(
        user_id=user_id,
        sku_id_default=sku_id_default,
        max_rounds=MAX_ROUNDS,
    )

    constraints = BuyerConstraints(
        target_price=round(target_price, 2),
        max_acceptable_price=derive_max_acceptable_price(target_price, float(seller_session.product.sale_price or 0)),
        list_price=float(seller_session.product.sale_price or 0),
        max_rounds=MAX_ROUNDS,
    )

    transcript: list[BuyerAgentTurn] = []
    final_price: float | None = None
    outcome: BuyerOutcome = "max_rounds_reached"

    decision = choose_opening_offer(constraints)

    for round_index in range(1, MAX_ROUNDS + 1):
        buyer_message = _build_buyer_message(decision, round_index=round_index)
        if decision.action == "walk_away":
            transcript.append(
                BuyerAgentTurn(
                    round_index=round_index,
                    action="walk_away",
                    buyer_offer=None,
                    buyer_message=buyer_message,
                    rationale=decision.rationale,
                    seller_turn=None,
                )
            )
            outcome = "walked_away"
            break

        seller_turn = await submit_buyer_offer(
            seller_session,
            NegotiationOfferIn(
                buyer_offer=decision.buyer_offer,
                buyer_message=buyer_message,
            ),
        )

        transcript.append(
                BuyerAgentTurn(
                    round_index=round_index,
                    action=decision.action,
                    buyer_offer=decision.buyer_offer,
                    buyer_message=buyer_message,
                    rationale=decision.rationale,
                seller_turn=seller_turn,
            )
        )

        if seller_turn.seller_decision == "accept":
            final_price = float(seller_turn.seller_counter_price or decision.buyer_offer or 0)
            outcome = "accepted"
            break

        if seller_session.closed:
            outcome = "seller_closed"
            break

        decision = decide_next_action(
            constraints,
            seller_turn=seller_turn,
            completed_rounds=round_index,
        )

    if outcome == "max_rounds_reached" and seller_session.accepted_price is not None:
        outcome = "accepted"
        final_price = float(seller_session.accepted_price)

    return BuyerAgentRunResult(
        run_id=_new_run_id(),
        user_id=user_id,
        sku_id_default=sku_id_default,
        target_price=constraints.target_price,
        max_acceptable_price=constraints.max_acceptable_price,
        outcome=outcome,
        final_price=final_price,
        summary=_build_summary(outcome, final_price, constraints),
        seller_session=seller_session,
        turns=transcript,
    )
