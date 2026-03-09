from pydantic import BaseModel, Field


class BundleSelection(BaseModel):
    sku: str
    reason: str = Field(default="")


class BundleOption(BaseModel):
    title: str = Field(default="Recommended Bundle")
    summary: str = Field(default="")
    explanation: str = Field(default="")
    selections: list[BundleSelection] = Field(default_factory=list)


class BundleComposeResult(BaseModel):
    options: list[BundleOption] = Field(default_factory=list)
