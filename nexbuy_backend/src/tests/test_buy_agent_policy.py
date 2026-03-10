from src.buy_agent.policy import (
    BuyerConstraints,
    choose_opening_offer,
    decide_next_action,
    derive_max_acceptable_price,
)
from src.sell_agent.schema import NegotiationTurn


def build_turn(
    *,
    decision: str,
    counter_price: float,
    buyer_offer: float | None = None,
    round_index: int = 1,
) -> NegotiationTurn:
    return NegotiationTurn(
        round_index=round_index,
        buyer_offer=buyer_offer,
        seller_decision=decision,  # type: ignore[arg-type]
        seller_counter_price=counter_price,
        seller_message="stub",
        current_target_price=counter_price,
        min_expected_price=counter_price - 50,
    )


def test_derive_max_acceptable_price_caps_at_list_price():
    assert derive_max_acceptable_price(900.0, 950.0) == 950.0


def test_choose_opening_offer_starts_below_target():
    constraints = BuyerConstraints(target_price=1000.0, max_acceptable_price=1100.0, list_price=1400.0)
    decision = choose_opening_offer(constraints)
    assert decision.action == "offer"
    assert decision.buyer_offer == 920.0


def test_decide_next_action_accepts_when_seller_hits_target():
    constraints = BuyerConstraints(target_price=900.0, max_acceptable_price=1000.0, list_price=1200.0)
    seller_turn = build_turn(decision="counter", counter_price=890.0, buyer_offer=840.0)
    decision = decide_next_action(constraints, seller_turn=seller_turn, completed_rounds=2)
    assert decision.action == "accept_seller_price"


def test_decide_next_action_walks_when_above_ceiling_in_final_round():
    constraints = BuyerConstraints(target_price=900.0, max_acceptable_price=950.0, list_price=1200.0)
    seller_turn = build_turn(decision="counter", counter_price=1020.0, buyer_offer=930.0, round_index=4)
    decision = decide_next_action(constraints, seller_turn=seller_turn, completed_rounds=4)
    assert decision.action == "walk_away"
