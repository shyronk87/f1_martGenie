from pydantic import BaseModel, Field


class TargetItem(BaseModel):
    category: str = Field(default="")
    quantity: int = Field(default=1)
    item_budget_allocation: float | None = Field(default=None)
    specific_features: list[str] = Field(default_factory=list)


class UserContentAnalysisResult(BaseModel):
    total_budget: float | None = Field(default=None)
    currency: str = Field(default="USD")
    style_preference: str | None = Field(default=None)
    room_type: str | None = Field(default=None)
    hard_constraints: list[str] = Field(default_factory=list)
    target_items: list[TargetItem] = Field(default_factory=list)
    is_ready: bool = Field(default=False)
    missing_fields: list[str] = Field(default_factory=list)
    agent_reply: str = Field(default="")
