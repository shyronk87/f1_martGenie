from datetime import datetime

from pydantic import BaseModel, Field


class ChatProjectCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    summary: str | None = Field(default=None, max_length=500)


class ChatProjectItemOut(BaseModel):
    id: str
    title: str
    summary: str | None = None
    updated_at: datetime


class ChatProjectListOut(BaseModel):
    items: list[ChatProjectItemOut] = Field(default_factory=list)
