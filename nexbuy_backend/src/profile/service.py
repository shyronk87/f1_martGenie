import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.web.profile.models import UserAddress

from .schema import UserAddressListResponse, UserAddressOut, UserAddressPayload


MAX_USER_ADDRESSES = 3


def _clean_scalar(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def normalize_payload(payload: UserAddressPayload) -> UserAddressPayload:
    return UserAddressPayload(
        recipient_name=_clean_scalar(payload.recipient_name),
        phone_number=_clean_scalar(payload.phone_number),
        country=_clean_scalar(payload.country),
        province_state=_clean_scalar(payload.province_state),
        city=_clean_scalar(payload.city),
        district=_clean_scalar(payload.district),
        street_line_1=_clean_scalar(payload.street_line_1),
        street_line_2=_clean_scalar(payload.street_line_2),
        postal_code=_clean_scalar(payload.postal_code),
        delivery_notes=_clean_scalar(payload.delivery_notes),
        is_default=bool(payload.is_default),
    )


def _to_out(model: UserAddress) -> UserAddressOut:
    return UserAddressOut(
        id=model.id,
        recipient_name=model.recipient_name,
        phone_number=model.phone_number,
        country=model.country,
        province_state=model.province_state,
        city=model.city,
        district=model.district,
        street_line_1=model.street_line_1,
        street_line_2=model.street_line_2,
        postal_code=model.postal_code,
        delivery_notes=model.delivery_notes,
        is_default=bool(model.is_default),
    )


async def _list_rows(session: AsyncSession, user_id: uuid.UUID) -> list[UserAddress]:
    rows = (
        await session.scalars(
            select(UserAddress)
            .where(UserAddress.user_id == user_id)
            .order_by(UserAddress.is_default.desc(), UserAddress.created_at.asc())
        )
    ).all()
    return list(rows)


async def list_addresses(session: AsyncSession, user_id: uuid.UUID) -> UserAddressListResponse:
    rows = await _list_rows(session, user_id)
    return UserAddressListResponse(addresses=[_to_out(row) for row in rows])


async def _unset_other_defaults(session: AsyncSession, user_id: uuid.UUID, keep_id: uuid.UUID) -> None:
    rows = await _list_rows(session, user_id)
    for row in rows:
        row.is_default = row.id == keep_id


async def create_address(
    session: AsyncSession,
    user_id: uuid.UUID,
    payload: UserAddressPayload,
) -> UserAddressListResponse:
    rows = await _list_rows(session, user_id)
    if len(rows) >= MAX_USER_ADDRESSES:
        raise ValueError("You can save up to 3 addresses.")

    normalized = normalize_payload(payload)
    should_be_default = normalized.is_default or len(rows) == 0
    row = UserAddress(
        user_id=user_id,
        recipient_name=normalized.recipient_name,
        phone_number=normalized.phone_number,
        country=normalized.country,
        province_state=normalized.province_state,
        city=normalized.city,
        district=normalized.district,
        street_line_1=normalized.street_line_1,
        street_line_2=normalized.street_line_2,
        postal_code=normalized.postal_code,
        delivery_notes=normalized.delivery_notes,
        is_default=should_be_default,
    )
    session.add(row)
    await session.flush()

    if should_be_default:
        await _unset_other_defaults(session, user_id, row.id)

    await session.commit()
    return await list_addresses(session, user_id)


async def update_address(
    session: AsyncSession,
    user_id: uuid.UUID,
    address_id: uuid.UUID,
    payload: UserAddressPayload,
) -> UserAddressListResponse:
    row = await session.scalar(
        select(UserAddress).where(UserAddress.user_id == user_id, UserAddress.id == address_id)
    )
    if row is None:
        raise ValueError("Address not found.")

    normalized = normalize_payload(payload)
    row.recipient_name = normalized.recipient_name
    row.phone_number = normalized.phone_number
    row.country = normalized.country
    row.province_state = normalized.province_state
    row.city = normalized.city
    row.district = normalized.district
    row.street_line_1 = normalized.street_line_1
    row.street_line_2 = normalized.street_line_2
    row.postal_code = normalized.postal_code
    row.delivery_notes = normalized.delivery_notes

    if normalized.is_default:
        await _unset_other_defaults(session, user_id, row.id)
    elif row.is_default:
        row.is_default = True

    await session.commit()
    return await list_addresses(session, user_id)


async def set_default_address(
    session: AsyncSession,
    user_id: uuid.UUID,
    address_id: uuid.UUID,
) -> UserAddressListResponse:
    row = await session.scalar(
        select(UserAddress).where(UserAddress.user_id == user_id, UserAddress.id == address_id)
    )
    if row is None:
        raise ValueError("Address not found.")

    await _unset_other_defaults(session, user_id, row.id)
    await session.commit()
    return await list_addresses(session, user_id)
