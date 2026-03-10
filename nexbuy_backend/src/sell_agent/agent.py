from __future__ import annotations

import math
import re
from typing import Any

from .pricing_engine import calculate_negotiation_params, round_to_human_price
from .schema import DecisionType, NegotiationSession, NegotiationTurn


_PRICE_RE = re.compile(r"\$?\s*([0-9]+(?:\.[0-9]{1,2})?)")


def parse_offer_from_message(message: str | None) -> float | None:
    if not message:
        return None
    m = _PRICE_RE.search(message)
    if not m:
        return None
    try:
        return float(m.group(1))
    except (TypeError, ValueError):
        return None


def _urgency_speed_factor(urgency: str) -> float:
    urgency_key = urgency.strip().upper()
    if urgency_key == "HOT":
        return 0.7
    if urgency_key == "URGENT":
        return 1.35
    return 1.0


def _current_target_price(session: NegotiationSession, round_index: int) -> float:
    max_expected = float(session.pricing_params.get("max_expected_price") or 0)
    min_expected = float(session.pricing_params.get("min_expected_price") or 0)
    if max_expected <= min_expected:
        return min_expected

    urgency = str(session.pricing_params.get("urgency_status") or "NORMAL")
    factor = _urgency_speed_factor(urgency)
    progress = min(1.0, max(0.0, round_index / max(session.max_rounds, 1)))
    concession = min(1.0, progress * factor)

    span = max_expected - min_expected
    raw = max_expected - span * concession
    price = max(min_expected, raw)
    return max(min_expected, round_to_human_price(price))


def _build_seller_message(
    decision: DecisionType,
    *,
    counter_price: float | None,
    current_target: float,
    min_expected: float,
) -> str:
    if decision == "need_offer":
        return (
            "Please share your target price so I can evaluate it against the current seller range."
        )
    if decision == "accept":
        return (
            f"Your offer works for us. We can close at ${counter_price:.2f} and proceed to order confirmation."
        )
    if decision == "counter":
        return (
            f"Thanks for the offer. We can do ${counter_price:.2f}. "
            f"Current expected deal level is around ${current_target:.2f}."
        )
    if decision == "reject":
        return (
            f"That is below our acceptable range. The minimum acceptable level is ${min_expected:.2f}."
        )
    return "This negotiation is already closed."


def initialize_pricing_params(product_payload: dict[str, Any]) -> dict[str, float | int | str]:
    return calculate_negotiation_params(product_payload)


def seller_decide(session: NegotiationSession, buyer_offer: float | None) -> NegotiationTurn:
    round_index = len(session.turns) + 1
    min_expected = float(session.pricing_params.get("min_expected_price") or 0)
    current_target = _current_target_price(session, round_index)

    if session.closed:
        decision: DecisionType = "closed"
        counter = session.accepted_price
    elif buyer_offer is None:
        decision = "need_offer"
        counter = current_target
    else:
        offer = float(buyer_offer)
        if offer >= current_target:
            decision = "accept"
            counter = offer
            session.closed = True
            session.accepted_price = round(offer, 2)
        elif offer >= min_expected:
            decision = "counter"
            midpoint = (offer + current_target) / 2.0
            counter = max(min_expected, round_to_human_price(midpoint))
        else:
            decision = "reject"
            counter = max(min_expected, round_to_human_price(current_target))

        if round_index >= session.max_rounds and not session.closed:
            # Final round policy: do not keep prolonged negotiation open.
            if offer >= min_expected:
                decision = "accept"
                counter = offer
                session.closed = True
                session.accepted_price = round(offer, 2)
            else:
                decision = "reject"
                counter = min_expected
                session.closed = True

    message = _build_seller_message(
        decision,
        counter_price=counter,
        current_target=current_target,
        min_expected=min_expected,
    )
    return NegotiationTurn(
        round_index=round_index,
        buyer_offer=buyer_offer,
        seller_decision=decision,
        seller_counter_price=round(counter, 2) if counter is not None else None,
        seller_message=message,
        current_target_price=round(current_target, 2),
        min_expected_price=round(min_expected, 2),
    )

