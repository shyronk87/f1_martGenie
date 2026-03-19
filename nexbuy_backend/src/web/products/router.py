from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.products.schema import ProductDetailOut
from src.products.service import get_product_detail
from src.web.auth.db import get_async_session


router = APIRouter(prefix="/products", tags=["products"])


@router.get("/{sku_id_default}", response_model=ProductDetailOut)
async def fetch_product_detail(
    sku_id_default: str,
    session: AsyncSession = Depends(get_async_session),
) -> ProductDetailOut:
    return await get_product_detail(session, sku_id_default=sku_id_default)
