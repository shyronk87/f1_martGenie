from pydantic import BaseModel


class ChatHistoryItemOut(BaseModel):
    session_id: str
    project_id: str | None = None
    title: str
    preview: str
    updated_at: str


class ChatHistoryListOut(BaseModel):
    sessions: list[ChatHistoryItemOut]
