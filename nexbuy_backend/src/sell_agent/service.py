from __future__ import annotations

from typing import Any
from uuid import uuid4

from .agent import initialize_pricing_params, parse_offer_from_message, seller_decide
from .db import get_product_for_negotiation
from .llm_parser import parse_buyer_intent
from .llm_responder import generate_seller_reply, propose_price_and_reply
from .schema import NegotiationOfferIn, NegotiationSession, NegotiationTurn


_SESSIONS: dict[str, NegotiationSession] = {}
LLM_PRICE_RETRY_LIMIT = 2


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _touch(session: NegotiationSession) -> None:
    from .schema import now_iso

    session.updated_at = now_iso()


def _verify_price_bounds(price: float, *, min_expected: float, list_price: float) -> tuple[bool, str | None]:
    if price < min_expected:
        return False, (
            f"Proposed price ${price:.2f} is too low. "
            f"It must be >= min_expected_price (${min_expected:.2f})."
        )
    if price > list_price:
        return False, (
            f"Proposed price ${price:.2f} is too high. "
            f"It must be <= list_price (${list_price:.2f})."
        )
    return True, None


def _build_final_confirmation(session: NegotiationSession, final_price: float, verified: bool) -> dict[str, str | float | bool]:
    min_expected = float(session.pricing_params.get("min_expected_price") or 0)
    return {
        "sku_id_default": session.product.sku_id_default,
        "title": session.product.title,
        "final_price": round(final_price, 2),
        "currency": "USD",
        "min_expected_price": round(min_expected, 2),
        "verification_passed": bool(verified and final_price >= min_expected),
        "verification_rule": "final_price >= min_expected_price",
    }


def _build_reason_summary(session: NegotiationSession, turn: NegotiationTurn) -> str:
    product_title = session.product.title or "this item"
    list_price = float(session.product.sale_price or 0)
    inventory = int(session.product.mock_inventory or 0)
    urgency = str(session.product.mock_urgency_status or "NORMAL").upper()
    min_expected = float(turn.min_expected_price or 0)
    current_target = float(turn.current_target_price or 0)
    counter_price = float(turn.seller_counter_price or current_target or min_expected)
    buyer_offer = float(turn.buyer_offer) if turn.buyer_offer is not None else None

    reasons: list[str] = []

    if turn.seller_decision == "need_offer":
        reasons.append(
            f"The seller needs a concrete offer for {product_title} before confirming any concession."
        )
    elif turn.seller_decision == "accept":
        if buyer_offer is not None and buyer_offer >= current_target:
            reasons.append(
                f"The buyer offer is already within the seller's workable closing range for {product_title}."
            )
        reasons.append(
            f"The agreed price of ${counter_price:.2f} is acceptable without further negotiation."
        )
    elif turn.seller_decision == "counter":
        if buyer_offer is not None:
            reasons.append(
                f"The buyer offer of ${buyer_offer:.2f} is serious, but still below the seller's preferred closing level."
            )
        reasons.append(
            f"The counter at ${counter_price:.2f} is positioned as a compromise between the buyer offer and the current target."
        )
    elif turn.seller_decision == "reject":
        if buyer_offer is not None:
            reasons.append(
                f"The buyer offer of ${buyer_offer:.2f} is below the currently acceptable level for {product_title}."
            )
        reasons.append(
            f"The seller cannot go below roughly ${min_expected:.2f} on this item right now."
        )
    else:
        reasons.append("This negotiation has already been closed by the seller.")

    if inventory <= 10:
        reasons.append("Inventory is tight, so discount room is limited.")
    elif inventory >= 120:
        reasons.append("There is enough inventory to allow some flexibility, but not an open-ended discount.")

    if urgency == "HOT":
        reasons.append("The item has healthy demand, so the seller is protecting price more carefully.")
    elif urgency == "URGENT":
        reasons.append("The seller is motivated to move this item, which supports a faster concession path.")

    if turn.round_index >= session.max_rounds:
        reasons.append("This is effectively the final round, so the response should sound decisive.")

    if list_price > 0:
        reasons.append(
            f"The list price is ${list_price:.2f}, so the seller should frame any concession as a meaningful move from that anchor."
        )

    return " ".join(reasons)


def _build_human_fallback_message(session: NegotiationSession, turn: NegotiationTurn) -> str:
    product_title = session.product.title or "this item"
    buyer_offer = float(turn.buyer_offer) if turn.buyer_offer is not None else None
    counter_price = float(turn.seller_counter_price or 0)
    min_expected = float(turn.min_expected_price or 0)

    if turn.seller_decision == "need_offer":
        return (
            f"I'd be glad to work on {product_title}, but I need a real number from you first. "
            "Send me your best offer and I'll see how close I can get."
        )
    if turn.seller_decision == "accept":
        return (
            f"That works on our side for {product_title}. "
            f"We can do ${counter_price:.2f}, and if you're ready, we can wrap it up from here."
        )
    if turn.seller_decision == "counter":
        buyer_part = (
            f"I see your offer at ${buyer_offer:.2f}, and we're not far off. "
            if buyer_offer is not None
            else ""
        )
        return (
            f"{buyer_part}I can't do that number yet, but I can bring {product_title} to "
            f"${counter_price:.2f}. That's a solid move from our side if you're ready to buy."
        )
    if turn.seller_decision == "reject":
        buyer_part = (
            f"I understand you're aiming for ${buyer_offer:.2f}, "
            if buyer_offer is not None
            else ""
        )
        return (
            f"{buyer_part}but that's lower than we can go on {product_title}. "
            f"If you want to keep this moving, we'd need to stay closer to ${min_expected:.2f}."
        )
    return (
        f"This negotiation for {product_title} is already closed. "
        "If you want to revisit the price, just start a new round."
    )


async def _apply_llm_price_with_guard(
    *,
    session: NegotiationSession,
    turn: NegotiationTurn,
    buyer_message: str | None,
    buyer_intent: Any,
) -> NegotiationTurn:
    # Only let LLM adjust price while negotiation is still open.
    if turn.seller_decision not in {"counter", "reject"}:
        return turn

    min_expected = float(turn.min_expected_price)
    list_price = float(session.product.sale_price or 0)
    recommended = float(turn.seller_counter_price or turn.current_target_price or min_expected)
    buyer_offer = turn.buyer_offer
    feedback_note: str | None = None

    for _ in range(LLM_PRICE_RETRY_LIMIT + 1):
        try:
            proposal = await propose_price_and_reply(
                decision_mode=turn.seller_decision,
                buyer_offer=buyer_offer,
                recommended_price=recommended,
                min_expected_price=min_expected,
                list_price=list_price,
                current_target_price=turn.current_target_price,
                buyer_message=buyer_message,
                buyer_intent=buyer_intent,
                feedback_note=feedback_note,
            )
            ok, reason = _verify_price_bounds(
                proposal.proposed_price,
                min_expected=min_expected,
                list_price=list_price,
            )
            if ok:
                turn.seller_counter_price = round(proposal.proposed_price, 2)
                turn.seller_message = proposal.reply_message
                turn.llm_price_verified = True
                turn.llm_verification_note = None
                return turn
            feedback_note = reason
        except Exception as exc:
            feedback_note = f"LLM proposal generation failed: {exc}"

    # Fallback to deterministic safe value when LLM keeps violating bounds.
    safe_price = max(min_expected, min(recommended, list_price))
    turn.seller_counter_price = round(safe_price, 2)
    turn.llm_price_verified = False
    turn.llm_verification_note = feedback_note or "LLM verification failed; fallback price applied."
    return turn


async def create_negotiation_session(
    *,
    user_id: str,
    sku_id_default: str,
    max_rounds: int,
    buyer_note: str | None = None,
) -> NegotiationSession:
    product = await get_product_for_negotiation(sku_id_default)
    if product is None:
        raise ValueError("Product not found.")

    pricing_params = initialize_pricing_params(
        {
            "sale_price": product.sale_price,
            "mock_min_floor_price": product.mock_min_floor_price,
            "mock_inventory": product.mock_inventory,
            "mock_urgency_status": product.mock_urgency_status,
        }
    )

    session = NegotiationSession(
        session_id=_new_id("nego"),
        user_id=user_id,
        product=product,
        max_rounds=max_rounds,
        pricing_params=pricing_params,
    )
    if buyer_note:
        intent = await parse_buyer_intent(buyer_note)
        opening_offer = intent.detected_offer
        if opening_offer is None:
            opening_offer = parse_offer_from_message(buyer_note)
        opening = seller_decide(session, opening_offer)
        opening = await _apply_llm_price_with_guard(
            session=session,
            turn=opening,
            buyer_message=buyer_note,
            buyer_intent=intent,
        )
        opening.seller_message = _build_human_fallback_message(session, opening)
        opening.seller_message = await generate_seller_reply(
            decision=opening.seller_decision,
            counter_price=opening.seller_counter_price,
            current_target_price=opening.current_target_price,
            min_expected_price=opening.min_expected_price,
            product_title=session.product.title,
            list_price=float(session.product.sale_price or 0),
            inventory=int(session.product.mock_inventory or 0),
            urgency_status=str(session.product.mock_urgency_status or "NORMAL"),
            round_index=opening.round_index,
            max_rounds=session.max_rounds,
            reason_summary=_build_reason_summary(session, opening),
            buyer_message=buyer_note,
            buyer_intent=intent,
            fallback_message=opening.seller_message,
        )
        if opening.seller_decision == "accept" and opening.seller_counter_price is not None:
            verified = opening.seller_counter_price >= opening.min_expected_price
            if verified:
                session.accepted_price = round(opening.seller_counter_price, 2)
            opening.final_confirmation = _build_final_confirmation(session, opening.seller_counter_price, verified)
        session.turns.append(opening)
    _SESSIONS[session.session_id] = session
    _touch(session)
    return session


def get_session(session_id: str) -> NegotiationSession | None:
    return _SESSIONS.get(session_id)


def ensure_owner(session: NegotiationSession, user_id: str) -> None:
    if session.user_id != user_id:
        raise PermissionError("This negotiation session does not belong to current user.")


async def submit_buyer_offer(session: NegotiationSession, payload: NegotiationOfferIn) -> NegotiationTurn:
    if session.closed:
        turn = seller_decide(session, payload.buyer_offer)
        session.turns.append(turn)
        _touch(session)
        return turn

    offer = payload.buyer_offer
    intent = None
    if payload.buyer_message:
        intent = await parse_buyer_intent(payload.buyer_message)
        if offer is None:
            offer = intent.detected_offer
    if offer is None:
        offer = parse_offer_from_message(payload.buyer_message)

    turn = seller_decide(session, offer)
    turn = await _apply_llm_price_with_guard(
        session=session,
        turn=turn,
        buyer_message=payload.buyer_message,
        buyer_intent=intent,
    )
    turn.seller_message = _build_human_fallback_message(session, turn)
    if payload.buyer_message:
        if intent is None:
            intent = await parse_buyer_intent(payload.buyer_message)
        turn.seller_message = await generate_seller_reply(
            decision=turn.seller_decision,
            counter_price=turn.seller_counter_price,
            current_target_price=turn.current_target_price,
            min_expected_price=turn.min_expected_price,
            product_title=session.product.title,
            list_price=float(session.product.sale_price or 0),
            inventory=int(session.product.mock_inventory or 0),
            urgency_status=str(session.product.mock_urgency_status or "NORMAL"),
            round_index=turn.round_index,
            max_rounds=session.max_rounds,
            reason_summary=_build_reason_summary(session, turn),
            buyer_message=payload.buyer_message,
            buyer_intent=intent,
            fallback_message=turn.seller_message,
        )
    if turn.seller_decision == "accept" and turn.seller_counter_price is not None:
        verified = turn.seller_counter_price >= turn.min_expected_price
        if not verified:
            # Force reopen if acceptance is below floor (should not happen after guard, but keep hard safety).
            turn.seller_decision = "counter"
            turn.llm_price_verified = False
            turn.llm_verification_note = (
                "Accepted price below minimum expected price. Re-opening negotiation for re-pricing."
            )
            turn.seller_counter_price = round(turn.min_expected_price, 2)
            turn.seller_message = (
                f"The proposed deal is below our minimum threshold. "
                f"The lowest acceptable confirmed price is ${turn.min_expected_price:.2f}."
            )
            session.closed = False
            session.accepted_price = None
        else:
            session.accepted_price = round(turn.seller_counter_price, 2)
            turn.final_confirmation = _build_final_confirmation(session, turn.seller_counter_price, True)
    session.turns.append(turn)
    _touch(session)
    return turn
