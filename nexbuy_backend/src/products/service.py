from collections.abc import Sequence

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import ProductDetailOut


def _to_float(value: object | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: object | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def get_product_detail(session: AsyncSession, sku_id_default: str) -> ProductDetailOut:
    stmt = text(
        """
        SELECT
            sku_id_default,
            spu_id,
            spu_code,
            title,
            sub_title,
            sku_code_default,
            category_name_1,
            category_name_2,
            category_name_3,
            category_name_4,
            rating_value,
            review_count,
            main_image_url,
            gallery_image_urls,
            description_text,
            specs,
            currency_symbol,
            sale_price,
            original_price,
            tag_price,
            compare_price,
            final_price,
            discount_text,
            discount_percent,
            stock_status_text,
            activity_price,
            activity_tip_text,
            product_url,
            canonical_url
        FROM homary_products
        WHERE sku_id_default = :sku_id_default
        LIMIT 1
        """
    )
    row = (await session.execute(stmt, {"sku_id_default": sku_id_default})).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Product not found.")

    category_path = [
        str(part).strip()
        for part in [
            row.get("category_name_1"),
            row.get("category_name_2"),
            row.get("category_name_3"),
            row.get("category_name_4"),
        ]
        if isinstance(part, str) and part.strip()
    ]

    gallery_images = row.get("gallery_image_urls")
    gallery_image_urls = [
        str(url).strip()
        for url in (gallery_images if isinstance(gallery_images, Sequence) and not isinstance(gallery_images, str) else [])
        if isinstance(url, str) and url.strip()
    ]
    main_image_url = str(row.get("main_image_url") or "").strip() or None
    if main_image_url and main_image_url not in gallery_image_urls:
        gallery_image_urls.insert(0, main_image_url)

    raw_specs = row.get("specs")
    specs = {
        str(key).strip(): str(value).strip()
        for key, value in raw_specs.items()
        if isinstance(raw_specs, dict)
        and str(key).strip()
        and value is not None
        and str(value).strip()
    }

    return ProductDetailOut(
        sku_id_default=str(row["sku_id_default"]),
        spu_id=str(row.get("spu_id")).strip() if row.get("spu_id") else None,
        spu_code=str(row.get("spu_code")).strip() if row.get("spu_code") else None,
        title=str(row["title"]),
        sub_title=str(row.get("sub_title")).strip() if row.get("sub_title") else None,
        sku_code_default=str(row.get("sku_code_default")).strip() if row.get("sku_code_default") else None,
        category_path=category_path,
        rating_value=_to_float(row.get("rating_value")),
        review_count=_to_int(row.get("review_count")),
        main_image_url=main_image_url,
        gallery_image_urls=gallery_image_urls,
        description_text=str(row.get("description_text")).strip() if row.get("description_text") else None,
        specs=specs,
        currency_symbol=str(row.get("currency_symbol")).strip() if row.get("currency_symbol") else None,
        sale_price=_to_float(row.get("sale_price")),
        original_price=_to_float(row.get("original_price")),
        tag_price=_to_float(row.get("tag_price")),
        compare_price=_to_float(row.get("compare_price")),
        final_price=_to_float(row.get("final_price")),
        discount_text=str(row.get("discount_text")).strip() if row.get("discount_text") else None,
        discount_percent=_to_float(row.get("discount_percent")),
        stock_status_text=str(row.get("stock_status_text")).strip() if row.get("stock_status_text") else None,
        activity_price=_to_float(row.get("activity_price")),
        activity_tip_text=str(row.get("activity_tip_text")).strip() if row.get("activity_tip_text") else None,
        product_url=str(row.get("product_url")).strip() if row.get("product_url") else None,
        canonical_url=str(row.get("canonical_url")).strip() if row.get("canonical_url") else None,
    )
