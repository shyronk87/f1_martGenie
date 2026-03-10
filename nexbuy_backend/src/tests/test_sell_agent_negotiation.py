import asyncio

from src.sell_agent.schema import NegotiationOfferIn
from src.sell_agent.service import create_negotiation_session, submit_buyer_offer


async def main() -> None:
    # Replace this SKU with an existing SKU in your database.
    sku = "10008"
    session = await create_negotiation_session(
        user_id="test-user",
        sku_id_default=sku,
        max_rounds=5,
    )
    print("session_id:", session.session_id)
    print("pricing:", session.pricing_params)

    offers = [session.product.sale_price * 0.7, session.product.sale_price * 0.82, session.product.sale_price * 0.9]
    for i, offer in enumerate(offers, start=1):
        turn = await submit_buyer_offer(
            session,
            NegotiationOfferIn(
                buyer_offer=round(offer, 2),
                buyer_message=f"I can do ${round(offer, 2)}. Can you make it work?",
            ),
        )
        print(
            f"round={i} decision={turn.seller_decision} "
            f"offer={turn.buyer_offer} counter={turn.seller_counter_price} "
            f"target={turn.current_target_price} floor={turn.min_expected_price}"
        )
        print("message:", turn.seller_message)
        if turn.seller_decision in {"accept", "closed"}:
            break


if __name__ == "__main__":
    asyncio.run(main())
