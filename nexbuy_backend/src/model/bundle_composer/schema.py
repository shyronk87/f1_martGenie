from pydantic import BaseModel, Field


class BundleSelection(BaseModel):
    sku: str
    reason: str = Field(default="")


class BundleComposeResult(BaseModel):
    title: str = Field(default="Recommended Bundle")
    summary: str = Field(default="")
    explanation: str = Field(default="")
    selections: list[BundleSelection] = Field(default_factory=list)
