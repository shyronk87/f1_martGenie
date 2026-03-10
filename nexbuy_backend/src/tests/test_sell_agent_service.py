from src.sell_agent.agent import seller_decide
from src.sell_agent.llm_parser import BuyerIntent, parse_buyer_intent
from src.sell_agent.schema import NegotiationProduct, NegotiationSession
from src.sell_agent.service import _apply_llm_price_with_guard


def build_session() -> NegotiationSession:
    return NegotiationSession(
        session_id="nego_test",
        user_id="user_1",
        product=NegotiationProduct(
            sku_id_default="sku-1",
            title="Test Product",
            sale_price=1000.0,
            mock_urgency_status="NORMAL",
            mock_inventory=80,
            mock_min_floor_price=700.0,
        ),
        max_rounds=5,
        pricing_params={
            "max_expected_price": 900.0,
            "min_expected_price": 800.0,
            "urgency_status": "NORMAL",
        },
    )


async def test_parse_buyer_intent_falls_back_when_llm_unavailable(monkeypatch):
    def raise_on_init(_: str):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr("src.sell_agent.llm_parser.get_llm_client", raise_on_init)

    result = await parse_buyer_intent("I can do $120 if you can ship today.")

    assert isinstance(result, BuyerIntent)
    assert result.detected_offer == 120.0


async def test_accept_turn_keeps_buyer_offer_without_llm_repricing(monkeypatch):
    async def fail_if_called(**_kwargs):
        raise AssertionError("LLM repricing should not run for accept decisions")

    monkeypatch.setattr("src.sell_agent.service.propose_price_and_reply", fail_if_called)

    session = build_session()
    turn = seller_decide(session, 950.0)

    updated = await _apply_llm_price_with_guard(
        session=session,
        turn=turn,
        buyer_message="I can do $950.",
        buyer_intent=BuyerIntent(detected_offer=950.0),
    )

    assert updated.seller_decision == "accept"
    assert updated.seller_counter_price == 950.0
    assert updated.llm_price_verified is True
