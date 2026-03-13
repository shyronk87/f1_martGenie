import uuid

from pydantic import BaseModel, Field


class UserAddressPayload(BaseModel):
    recipient_name: str | None = Field(default=None, max_length=128)
    phone_number: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
    province_state: str | None = Field(default=None, max_length=128)
    city: str | None = Field(default=None, max_length=128)
    district: str | None = Field(default=None, max_length=128)
    street_line_1: str | None = Field(default=None, max_length=255)
    street_line_2: str | None = Field(default=None, max_length=255)
    postal_code: str | None = Field(default=None, max_length=32)
    delivery_notes: str | None = None
    is_default: bool = False


class UserAddressOut(UserAddressPayload):
    id: uuid.UUID


class UserAddressListResponse(BaseModel):
    addresses: list[UserAddressOut] = Field(default_factory=list)
