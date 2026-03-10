from __future__ import annotations

from sqlalchemy import text

from src.web.auth.db import async_session_maker

from .schema import NegotiationProduct


async def get_product_for_negotiation(sku_id_default: str) -> NegotiationProduct | None:
    stmt = text(
        """
        SELECT
            sku_id_default,
            COALESCE(title, '') AS title,
            COALESCE(sale_price, 0) AS sale_price,
            COALESCE(mock_urgency_status, 'NORMAL') AS mock_urgency_status,
            COALESCE(mock_inventory, 0) AS mock_inventory,
            mock_min_floor_price
        FROM homary_products
        WHERE sku_id_default = :sku
        LIMIT 1
        """
    )
    async with async_session_maker() as session:
        row = (await session.execute(stmt, {"sku": sku_id_default})).mappings().first()
    if row is None:
        return None
    return NegotiationProduct(**dict(row))

