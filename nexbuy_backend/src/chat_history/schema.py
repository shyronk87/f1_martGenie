from pydantic import BaseModel


class ChatHistoryItemOut(BaseModel):
    session_id: str
    title: str
    preview: str
    updated_at: str


class ChatHistoryListOut(BaseModel):
    sessions: list[ChatHistoryItemOut]
