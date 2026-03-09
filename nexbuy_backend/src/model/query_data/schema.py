from pydantic import BaseModel, Field


class QueryFilters(BaseModel):
    max_budget: float | None = Field(default=None)
    style_keywords: list[str] = Field(default_factory=list)
    room_keywords: list[str] = Field(default_factory=list)
    item_categories: list[str] = Field(default_factory=list)
    constraint_keywords: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=100)


class ProductRow(BaseModel):
    sku_id_default: str
    spu_id: str | None = None
    title: str
    category_name_1: str | None = None
    category_name_2: str | None = None
    category_name_3: str | None = None
    category_name_4: str | None = None
    sale_price: float | None = None
    original_price: float | None = None
    stock_status_text: str | None = None
    main_image_url: str | None = None
    product_url: str | None = None


class QueryDataResult(BaseModel):
    is_ready: bool
    missing_fields: list[str] = Field(default_factory=list)
    agent_reply: str = Field(default="")
    filters: QueryFilters | None = None
    products: list[ProductRow] = Field(default_factory=list)
