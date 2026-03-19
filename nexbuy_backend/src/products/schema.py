from pydantic import BaseModel, Field


class ProductDetailOut(BaseModel):
    sku_id_default: str
    spu_id: str | None = None
    spu_code: str | None = None
    title: str
    sub_title: str | None = None
    sku_code_default: str | None = None
    category_path: list[str] = Field(default_factory=list)
    rating_value: float | None = None
    review_count: int | None = None
    main_image_url: str | None = None
    gallery_image_urls: list[str] = Field(default_factory=list)
    description_text: str | None = None
    specs: dict[str, str] = Field(default_factory=dict)
    currency_symbol: str | None = None
    sale_price: float | None = None
    original_price: float | None = None
    tag_price: float | None = None
    compare_price: float | None = None
    final_price: float | None = None
    discount_text: str | None = None
    discount_percent: float | None = None
    stock_status_text: str | None = None
    activity_price: float | None = None
    activity_tip_text: str | None = None
    product_url: str | None = None
    canonical_url: str | None = None
