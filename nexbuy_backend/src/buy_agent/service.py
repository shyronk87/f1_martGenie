from __future__ import annotations

from typing import Any, AsyncIterator
from uuid import uuid4

from src.sell_agent.schema import NegotiationOfferIn, NegotiationTurn
from src.sell_agent.service import create_negotiation_session, submit_buyer_offer

from .llm_decider import BuyerLLMDecision, propose_buyer_decision
from .policy import (
    MAX_ROUNDS,
    BuyerConstraints,
    BuyerDecision,
    choose_opening_offer,
    decide_next_action,
)
from .schema import BuyerAgentRunResult, BuyerAgentTurn, BuyerOutcome

_RUN_CANCEL_FLAGS: dict[str, bool] = {}


def _new_run_id() -> str:
    return f"buyer_run_{uuid4().hex}"


class BuyerAgentRunCancelled(Exception):
    def __init__(self, run_id: str):
        super().__init__("Buyer agent negotiation cancelled.")
        self.run_id = run_id


def cancel_buyer_run(run_id: str) -> bool:
    if run_id not in _RUN_CANCEL_FLAGS:
        return False
    _RUN_CANCEL_FLAGS[run_id] = True
    return True


def _register_run(run_id: str) -> None:
    _RUN_CANCEL_FLAGS[run_id] = False


def _clear_run(run_id: str) -> None:
    _RUN_CANCEL_FLAGS.pop(run_id, None)


def _ensure_run_active(run_id: str) -> None:
    if _RUN_CANCEL_FLAGS.get(run_id):
        raise BuyerAgentRunCancelled(run_id)


def _build_buyer_message(action: BuyerDecision, *, round_index: int) -> str:
    if action.action == "walk_away":
        return (
            "Thanks for working with me, but I can't make the numbers work on my side right now. "
            "I'll hold off for now unless there's a little more room."
        )

    if action.action == "accept_seller_price":
        assert action.buyer_offer is not None
        return (
            f"That works for me. If you can do ${action.buyer_offer:.2f}, I'm happy to move ahead."
        )

    assert action.buyer_offer is not None
    if round_index == 1:
        return (
            f"I'm genuinely interested, but I need a little better pricing to feel good about it. "
            f"Could you do ${action.buyer_offer:.2f}?"
        )
    return (
        f"I can come up a bit from where I started. "
        f"If you can make ${action.buyer_offer:.2f} work, I'd be comfortable closing this out."
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


def _serialize_seller_turn(turn: NegotiationTurn) -> dict[str, Any]:
    return turn.model_dump()


def _serialize_buyer_turn(turn: BuyerAgentTurn) -> dict[str, Any]:
    return turn.model_dump()


def _transcript_summary(turns: list[BuyerAgentTurn]) -> str:
    if not turns:
        return "No prior turns."
    snippets: list[str] = []
    for turn in turns[-3:]:
        seller_part = (
            f"seller_decision={turn.seller_turn.seller_decision}, seller_price={turn.seller_turn.seller_counter_price}"
            if turn.seller_turn is not None
            else "seller_decision=None"
        )
        snippets.append(
            f"round={turn.round_index}, buyer_action={turn.action}, buyer_offer={turn.buyer_offer}, {seller_part}"
        )
    return " | ".join(snippets)


def _normalize_decision(decision: BuyerDecision, *, round_index: int) -> BuyerDecision:
    rationale = decision.rationale.strip() or "Use a controlled buyer-side move based on the current negotiation state."
    return BuyerDecision(
        action=decision.action,
        buyer_offer=decision.buyer_offer,
        rationale=rationale,
    )


def _validate_llm_decision(
    llm_decision: BuyerLLMDecision,
    *,
    constraints: BuyerConstraints,
    seller_turn: NegotiationTurn | None,
) -> tuple[bool, str | None]:
    if llm_decision.action not in {"offer", "accept_seller_price", "walk_away"}:
        return False, f"Unsupported action: {llm_decision.action}"

    if llm_decision.action == "walk_away":
        return True, None

    if llm_decision.buyer_offer is None:
        return False, "buyer_offer is required for offer/accept decisions."

    if llm_decision.buyer_offer <= 0:
        return False, "buyer_offer must be positive."

    if llm_decision.buyer_offer > constraints.max_acceptable_price:
        return False, "buyer_offer exceeds max_acceptable_price."

    if llm_decision.action == "accept_seller_price":
        seller_price = float(
            (seller_turn.seller_counter_price if seller_turn is not None else None)
            or (seller_turn.current_target_price if seller_turn is not None else 0)
            or 0
        )
        if seller_turn is None:
            return False, "Cannot accept seller price without a seller turn."
        if seller_price > constraints.max_acceptable_price:
            return False, "Seller price is above max_acceptable_price."
        if abs(llm_decision.buyer_offer - seller_price) > 0.01:
            return False, "buyer_offer must match seller price when accepting."

    return True, None


async def _choose_llm_backed_decision(
    *,
    constraints: BuyerConstraints,
    seller_session,
    transcript: list[BuyerAgentTurn],
    round_index: int,
    seller_turn: NegotiationTurn | None,
) -> tuple[BuyerDecision, str, bool, str | None]:
    fallback = choose_opening_offer(constraints) if seller_turn is None else decide_next_action(
        constraints,
        seller_turn=seller_turn,
        completed_rounds=round_index - 1,
    )
    fallback = _normalize_decision(fallback, round_index=round_index)
    fallback_message = _build_buyer_message(fallback, round_index=round_index)

    try:
        proposal = await propose_buyer_decision(
            sku_id_default=seller_session.product.sku_id_default,
            product_title=seller_session.product.title,
            list_price=float(seller_session.product.sale_price or 0),
            target_price=constraints.target_price,
            max_acceptable_price=constraints.max_acceptable_price,
            round_index=round_index,
            max_rounds=constraints.max_rounds,
            seller_turn=seller_turn,
            transcript_summary=_transcript_summary(transcript),
        )
        ok, reason = _validate_llm_decision(proposal, constraints=constraints, seller_turn=seller_turn)
        if not ok:
            return fallback, fallback_message, False, reason or "LLM decision failed validation."
        return (
            BuyerDecision(
                action=proposal.action,  # type: ignore[arg-type]
                buyer_offer=round(proposal.buyer_offer, 2) if proposal.buyer_offer is not None else None,
                rationale=proposal.rationale.strip() or fallback.rationale,
            ),
            proposal.buyer_message.strip() or fallback_message,
            True,
            None,
        )
    except Exception as exc:
        return fallback, fallback_message, False, f"LLM buyer decision failed: {exc}"


async def run_buyer_negotiation(
    *,
    user_id: str,
    sku_id_default: str,
    target_price: float,
    max_acceptable_price: float,
) -> BuyerAgentRunResult:
    seller_session = await create_negotiation_session(
        user_id=user_id,
        sku_id_default=sku_id_default,
        max_rounds=MAX_ROUNDS,
    )

    constraints = BuyerConstraints(
        target_price=round(target_price, 2),
        max_acceptable_price=round(min(max_acceptable_price, float(seller_session.product.sale_price or 0)), 2),
        list_price=float(seller_session.product.sale_price or 0),
        max_rounds=MAX_ROUNDS,
    )

    transcript: list[BuyerAgentTurn] = []
    final_price: float | None = None
    outcome: BuyerOutcome = "max_rounds_reached"

    for round_index in range(1, MAX_ROUNDS + 1):
        previous_seller_turn = transcript[-1].seller_turn if transcript else None
        decision, buyer_message, llm_decision_verified, llm_verification_note = await _choose_llm_backed_decision(
            constraints=constraints,
            seller_session=seller_session,
            transcript=transcript,
            round_index=round_index,
            seller_turn=previous_seller_turn,
        )
        if decision.action == "walk_away":
            transcript.append(
                BuyerAgentTurn(
                    round_index=round_index,
                    action="walk_away",
                    buyer_offer=None,
                    buyer_message=buyer_message,
                    rationale=decision.rationale,
                    llm_decision_verified=llm_decision_verified,
                    llm_verification_note=llm_verification_note,
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
                llm_decision_verified=llm_decision_verified,
                llm_verification_note=llm_verification_note,
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


async def stream_buyer_negotiation(
    *,
    user_id: str,
    sku_id_default: str,
    target_price: float,
    max_acceptable_price: float,
) -> AsyncIterator[dict[str, Any]]:
    run_id = _new_run_id()
    _register_run(run_id)
    try:
        _ensure_run_active(run_id)
        seller_session = await create_negotiation_session(
            user_id=user_id,
            sku_id_default=sku_id_default,
            max_rounds=MAX_ROUNDS,
        )

        constraints = BuyerConstraints(
            target_price=round(target_price, 2),
            max_acceptable_price=round(min(max_acceptable_price, float(seller_session.product.sale_price or 0)), 2),
            list_price=float(seller_session.product.sale_price or 0),
            max_rounds=MAX_ROUNDS,
        )

        transcript: list[BuyerAgentTurn] = []
        final_price: float | None = None
        outcome: BuyerOutcome = "max_rounds_reached"

        yield {
            "type": "session_started",
            "run_id": run_id,
            "seller_session": seller_session.model_dump(),
            "target_price": constraints.target_price,
            "max_acceptable_price": constraints.max_acceptable_price,
            "max_rounds": constraints.max_rounds,
        }

        for round_index in range(1, MAX_ROUNDS + 1):
            _ensure_run_active(run_id)
            previous_seller_turn = transcript[-1].seller_turn if transcript else None
            yield {
                "type": "thinking",
                "phase": "buyer_decision",
                "round_index": round_index,
                "message": f"Buyer agent is planning round {round_index}.",
            }
            decision, buyer_message, llm_decision_verified, llm_verification_note = await _choose_llm_backed_decision(
                constraints=constraints,
                seller_session=seller_session,
                transcript=transcript,
                round_index=round_index,
                seller_turn=previous_seller_turn,
            )
            _ensure_run_active(run_id)
            if decision.action == "walk_away":
                buyer_turn = BuyerAgentTurn(
                    round_index=round_index,
                    action="walk_away",
                    buyer_offer=None,
                    buyer_message=buyer_message,
                    rationale=decision.rationale,
                    llm_decision_verified=llm_decision_verified,
                    llm_verification_note=llm_verification_note,
                    seller_turn=None,
                )
                transcript.append(buyer_turn)
                yield {"type": "buyer_turn", "turn": _serialize_buyer_turn(buyer_turn)}
                outcome = "walked_away"
                break

            buyer_turn = BuyerAgentTurn(
                round_index=round_index,
                action=decision.action,
                buyer_offer=decision.buyer_offer,
                buyer_message=buyer_message,
                rationale=decision.rationale,
                llm_decision_verified=llm_decision_verified,
                llm_verification_note=llm_verification_note,
                seller_turn=None,
            )
            yield {"type": "buyer_turn", "turn": _serialize_buyer_turn(buyer_turn)}

            yield {
                "type": "thinking",
                "phase": "seller_response",
                "round_index": round_index,
                "message": f"Seller agent is evaluating round {round_index}.",
            }
            seller_turn = await submit_buyer_offer(
                seller_session,
                NegotiationOfferIn(
                    buyer_offer=decision.buyer_offer,
                    buyer_message=buyer_message,
                ),
            )
            _ensure_run_active(run_id)
            buyer_turn.seller_turn = seller_turn
            transcript.append(buyer_turn)
            yield {"type": "seller_turn", "turn": _serialize_seller_turn(seller_turn)}

            if seller_turn.seller_decision == "accept":
                final_price = float(seller_turn.seller_counter_price or decision.buyer_offer or 0)
                outcome = "accepted"
                break

            if seller_session.closed:
                outcome = "seller_closed"
                break

        if outcome == "max_rounds_reached" and seller_session.accepted_price is not None:
            outcome = "accepted"
            final_price = float(seller_session.accepted_price)

        result = BuyerAgentRunResult(
            run_id=run_id,
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
        yield {"type": "done", "result": result.model_dump()}
    except BuyerAgentRunCancelled:
        yield {"type": "error", "error": "Buyer agent negotiation cancelled.", "run_id": run_id}
    finally:
        _clear_run(run_id)
