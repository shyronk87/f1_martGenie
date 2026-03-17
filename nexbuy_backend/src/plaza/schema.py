import uuid
from datetime import datetime

from pydantic import BaseModel, Field, computed_field


class AgentShowcaseCreateItemIn(BaseModel):
    sku_id_default: str = Field(min_length=1)
    quantity: int = Field(default=1, ge=1, le=20)
    final_price_used: float | None = Field(default=None, ge=0)
    sort_order: int = Field(default=0, ge=0)


class AgentShowcaseCreateIn(BaseModel):
    bundle_name: str | None = None
    summary: str | None = None
    approved_at: datetime | None = None
    source_chat_session_id: str | None = None
    source_negotiation_session_id: str | None = None
    items: list[AgentShowcaseCreateItemIn] = Field(min_length=1)


class AgentShowcaseItem(BaseModel):
    sku_id_default: str
    spu_id: str | None = None
    title: str
    category_name_1: str | None = None
    category_name_2: str | None = None
    category_name_3: str | None = None
    category_name_4: str | None = None
    main_image_url: str | None = None
    product_url: str | None = None
    quantity: int
    original_price: float
    sale_price: float
    final_price_used: float
    saved_amount: float
    sort_order: int


class AgentShowcaseSummary(BaseModel):
    id: uuid.UUID
    user_display_masked: str
    headline: str
    summary: str | None = None
    bundle_name: str | None = None
    item_count: int
    currency_symbol: str = "$"
    total_original_price: float
    total_final_price: float
    total_saved_amount: float
    cover_sku_id_default: str | None = None
    cover_image_url: str | None = None
    approved_at: datetime
    created_at: datetime


class AgentShowcaseDetail(AgentShowcaseSummary):
    items: list[AgentShowcaseItem] = Field(default_factory=list)

    @computed_field
    @property
    def primary_categories(self) -> list[str]:
        seen: set[str] = set()
        categories: list[str] = []
        for item in self.items:
            for value in [item.category_name_1, item.category_name_2, item.category_name_3]:
                if not value:
                    continue
                if value in seen:
                    continue
                seen.add(value)
                categories.append(value)
        return categories[:4]


class AgentShowcaseMockSeedOut(BaseModel):
    created_count: int
    total_count: int


class PlazaRecommendationProduct(BaseModel):
    sku_id_default: str
    spu_id: str | None = None
    title: str
    description_text: str | None = None
    category_name_1: str | None = None
    category_name_2: str | None = None
    category_name_3: str | None = None
    category_name_4: str | None = None
    sale_price: float | None = None
    original_price: float | None = None
    stock_status_text: str | None = None
    main_image_url: str | None = None
    product_url: str | None = None
    specs: dict[str, str] | None = None
    recommendation_reason: str
    matched_memory_tags: list[str] = Field(default_factory=list)


class PlazaRecommendationsOut(BaseModel):
    onboarding_required: bool
    memory_summary: str
    reason_tags: list[str] = Field(default_factory=list)
    products: list[PlazaRecommendationProduct] = Field(default_factory=list)
