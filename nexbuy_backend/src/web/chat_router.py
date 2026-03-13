import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from datetime import timedelta
from typing import Any
from uuid import UUID
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.model.bundle_composer import compose_bundle_with_ai
from src.model.memory import get_profile
from src.model.query_data import query_products_from_analysis
from src.model.user_content_analysis import analyze_user_content_with_debug
from src.web.auth.db import async_session_maker
from src.web.auth.dependencies import CurrentActiveUser
from src.web.auth.models import User


router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _tokenize(text: str) -> list[str]:
    parts = re.split(r"[^a-z0-9]+", text.lower())
    return [p for p in parts if p]


def _matches_target_category(product: Any, target_category: str) -> bool:
    target = target_category.lower().strip()
    searchable = " ".join(
        [
            str(getattr(product, "title", "") or "").lower(),
            str(getattr(product, "category_name_1", "") or "").lower(),
            str(getattr(product, "category_name_2", "") or "").lower(),
            str(getattr(product, "category_name_3", "") or "").lower(),
            str(getattr(product, "category_name_4", "") or "").lower(),
        ]
    )
    if target and target in searchable:
        return True

    target_tokens = _tokenize(target)
    if not target_tokens:
        return False
    return all(token in searchable for token in target_tokens if len(token) >= 3)


def _build_bundle_items(products: list[Any], analysis: Any) -> tuple[list[dict[str, Any]], int]:
    selected: list[dict[str, Any]] = []
    used_skus: set[str] = set()
    matched_target_count = 0

    for target in analysis.target_items:
        category = (target.category or "").strip()
        if not category:
            continue
        need = max(1, int(target.quantity or 1))
        matched_for_category = 0
        for p in products:
            sku = str(getattr(p, "sku_id_default", "") or "")
            if not sku or sku in used_skus:
                continue
            if not _matches_target_category(p, category):
                continue

            selected.append(
                {
                    "sku": sku,
                    "title": p.title,
                    "price": float(p.sale_price or 0),
                    "reason": f"Matched target item: {category}.",
                    "imageUrl": p.main_image_url,
                    "productUrl": p.product_url,
                    "description": getattr(p, "description_text", None),
                    "categoryLabel": " / ".join(
                        [
                            part
                            for part in [
                                getattr(p, "category_name_2", None),
                                getattr(p, "category_name_3", None),
                            ]
                            if part
                        ]
                    )
                    or None,
                    "specs": getattr(p, "specs", None),
                }
            )
            used_skus.add(sku)
            matched_for_category += 1
            if matched_for_category >= need:
                break

        if matched_for_category > 0:
            matched_target_count += 1

    if not selected:
        for p in products[:3]:
            sku = str(getattr(p, "sku_id_default", "") or "")
            if not sku:
                continue
            selected.append(
                {
                    "sku": sku,
                    "title": p.title,
                    "price": float(p.sale_price or 0),
                    "reason": "Top-ranked product from current query.",
                    "imageUrl": p.main_image_url,
                    "productUrl": p.product_url,
                    "description": getattr(p, "description_text", None),
                    "categoryLabel": " / ".join(
                        [
                            part
                            for part in [
                                getattr(p, "category_name_2", None),
                                getattr(p, "category_name_3", None),
                            ]
                            if part
                        ]
                    )
                    or None,
                    "specs": getattr(p, "specs", None),
                }
            )

    return selected, matched_target_count


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1)


class SessionCreateResponse(BaseModel):
    session_id: str


class SendMessageResponse(BaseModel):
    message_id: str
    task_id: str
    status: str


class SessionDumpResponse(BaseModel):
    session_id: str
    messages: list[dict[str, Any]]
    timeline: list[dict[str, Any]]
    plans: list[dict[str, Any]]


class OrderItemIn(BaseModel):
    sku: str
    title: str
    price: float
    quantity: int = 1


class CreateMockOrderIn(BaseModel):
    session_id: str
    plan_id: str
    items: list[OrderItemIn]
    payment_method: str = "card"
    shipping_address: str = "N/A"


class CreateMockOrderOut(BaseModel):
    order_id: str
    order_status: str
    payment_status: str
    total_amount: float
    currency: str
    tracking_number: str
    carrier: str
    estimated_delivery_date: str
    warehouse_note: str
    support_contact: str
    created_at: str


_SESSIONS: dict[str, dict[str, Any]] = {}
_TASKS: dict[str, dict[str, str]] = {}
ANALYZE_TIMEOUT_SECONDS = 120
QUERY_TIMEOUT_SECONDS = 20
COMPOSE_TIMEOUT_SECONDS = 120


@router.post("/sessions", response_model=SessionCreateResponse)
async def create_session(user: User = Depends(CurrentActiveUser)) -> SessionCreateResponse:
    session_id = _new_id("sess")
    _SESSIONS[session_id] = {
        "messages": [],
        "timeline": [],
        "plans": [],
        "user_id": str(user.id),
    }
    return SessionCreateResponse(session_id=session_id)


@router.post("/sessions/{session_id}/messages", response_model=SendMessageResponse, status_code=202)
async def send_message(
    session_id: str,
    payload: ChatMessageIn,
    user: User = Depends(CurrentActiveUser),
) -> SendMessageResponse:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if session.get("user_id") != str(user.id):
        raise HTTPException(status_code=403, detail="This session does not belong to current user.")

    message_id = _new_id("msg")
    session["messages"].append(
        {
            "id": message_id,
            "role": "user",
            "content": payload.content.strip(),
            "createdAt": _now_iso(),
        }
    )
    task_id = _new_id("task")
    _TASKS[task_id] = {"session_id": session_id, "status": "accepted"}
    return SendMessageResponse(message_id=message_id, task_id=task_id, status="accepted")


@router.get("/sessions/{session_id}", response_model=SessionDumpResponse)
async def get_session(
    session_id: str,
    user: User = Depends(CurrentActiveUser),
) -> SessionDumpResponse:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if session.get("user_id") != str(user.id):
        raise HTTPException(status_code=403, detail="This session does not belong to current user.")
    return SessionDumpResponse(
        session_id=session_id,
        messages=session["messages"],
        timeline=session["timeline"],
        plans=session["plans"],
    )


@router.get("/sessions/{session_id}/stream")
async def stream_session(session_id: str, task_id: str = Query(...)) -> StreamingResponse:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    task = _TASKS.get(task_id)
    if task is None or task["session_id"] != session_id:
        raise HTTPException(status_code=404, detail="Task not found for this session.")

    async def event_generator():
        logger.info("chat.stream start session_id=%s task_id=%s", session_id, task_id)

        def add_timeline(event_type: str, message: str) -> str:
            event = {
                "id": _new_id("evt"),
                "type": event_type,
                "message": message,
                "createdAt": _now_iso(),
            }
            session["timeline"].insert(0, event)
            return _sse({"type": "timeline_event", "event": event})

        try:
            logger.info("chat.stream initial_yields session_id=%s task_id=%s", session_id, task_id)
            yield _sse({"type": "message_delta", "delta": "Analyzing your requirements... "})
            yield add_timeline("scan_started", "Started parsing requirements.")

            conversation = [
                {"role": m["role"], "content": m["content"]}
                for m in session["messages"]
                if m.get("role") in {"user", "assistant", "system"}
            ]
            logger.info(
                "chat.stream conversation_ready session_id=%s task_id=%s messages=%s",
                session_id,
                task_id,
                len(conversation),
            )

            long_term_memory: dict[str, Any] | None = None
            user_id_raw = str(session.get("user_id") or "").strip()
            if user_id_raw:
                try:
                    logger.info(
                        "chat.stream loading_memory session_id=%s task_id=%s user_id=%s",
                        session_id,
                        task_id,
                        user_id_raw,
                    )
                    user_id = UUID(user_id_raw)
                    async with async_session_maker() as db_session:
                        profile_resp = await get_profile(db_session, user_id)
                    if profile_resp.profile is not None:
                        profile_payload = profile_resp.profile.model_dump()
                        long_term_memory = {
                            k: v for k, v in profile_payload.items() if v not in (None, "", [], {})
                        }
                except Exception:
                    logger.exception(
                        "chat.stream memory_load_failed session_id=%s task_id=%s",
                        session_id,
                        task_id,
                    )
                    long_term_memory = None
            if long_term_memory:
                loaded_keys = list(long_term_memory.keys())
                yield add_timeline("scan_progress", f"Loaded long-term memory: {loaded_keys}")
            else:
                yield add_timeline("scan_progress", "No long-term memory loaded for current user.")

            yield add_timeline("scan_progress", "Sending request to requirement-analysis model.")
            logger.info(
                "chat.stream analyze_start session_id=%s task_id=%s has_memory=%s",
                session_id,
                task_id,
                bool(long_term_memory),
            )
            try:
                analysis, analysis_logs = await asyncio.wait_for(
                    analyze_user_content_with_debug(
                        conversation,
                        long_term_memory=long_term_memory,
                    ),
                    timeout=ANALYZE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                yield add_timeline("error", "Analysis timeout. Please retry with a shorter message.")
                yield _sse({"type": "error", "error": "Analysis timeout. Please retry."})
                yield _sse({"type": "done"})
                return
            logger.info(
                "chat.stream analyze_done session_id=%s task_id=%s ready=%s missing=%s items=%s",
                session_id,
                task_id,
                analysis.is_ready,
                analysis.missing_fields,
                len(analysis.target_items),
            )

            for log in analysis_logs:
                yield add_timeline("scan_progress", log)

            yield add_timeline("scan_progress", "Structured fields extracted.")
            yield add_timeline("scan_progress", "Searching product catalog with extracted filters.")
            logger.info("chat.stream query_start session_id=%s task_id=%s", session_id, task_id)
            try:
                query_result = await asyncio.wait_for(
                    query_products_from_analysis(
                        analysis,
                        limit=50,
                        long_term_memory=long_term_memory,
                    ),
                    timeout=QUERY_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                yield add_timeline("error", "Database query timeout. Please retry.")
                yield _sse({"type": "error", "error": "Query timeout. Please retry."})
                yield _sse({"type": "done"})
                return
            logger.info(
                "chat.stream query_done session_id=%s task_id=%s ready=%s products=%s",
                session_id,
                task_id,
                query_result.is_ready,
                len(query_result.products),
            )

            for log in query_result.debug_logs:
                yield add_timeline("scan_progress", log)

            if not query_result.is_ready:
                assistant_text = query_result.agent_reply or "Please provide more details."
                assistant_message = {
                    "id": _new_id("msg"),
                    "role": "assistant",
                    "content": assistant_text,
                    "createdAt": _now_iso(),
                }
                session["messages"].append(assistant_message)
                yield _sse({"type": "message", "message": assistant_message})
                yield add_timeline("done", "Need more user details before searching products.")
                yield _sse({"type": "done"})
                return

            yield add_timeline("candidate_found", f"Found {len(query_result.products)} matching products.")

            if query_result.products:
                yield add_timeline("bundle_built", "Sending ranked candidates to bundle composer.")
                logger.info(
                    "chat.stream compose_start session_id=%s task_id=%s candidates=%s",
                    session_id,
                    task_id,
                    len(query_result.products),
                )
                try:
                    ai_bundle, bundle_logs = await asyncio.wait_for(
                        compose_bundle_with_ai(
                            analysis,
                            query_result.products,
                            long_term_memory=long_term_memory,
                        ),
                        timeout=COMPOSE_TIMEOUT_SECONDS,
                    )
                    for log in bundle_logs:
                        yield add_timeline("bundle_built", log)
                except asyncio.TimeoutError:
                    yield add_timeline("bundle_built", "AI bundle composition timeout, fallback used.")
                    ai_bundle = None
                logger.info(
                    "chat.stream compose_done session_id=%s task_id=%s ai_bundle=%s",
                    session_id,
                    task_id,
                    bool(ai_bundle and ai_bundle.options),
                )

                plans: list[dict[str, Any]] = []
                target_labels = [t.category for t in analysis.target_items if t.category]
                product_map = {p.sku_id_default: p for p in query_result.products}

                if ai_bundle is not None and ai_bundle.options:
                    for option in ai_bundle.options[:5]:
                        bundle_items = []
                        for sel in option.selections:
                            p = product_map.get(sel.sku)
                            if p is None:
                                continue
                            bundle_items.append(
                                {
                                    "sku": p.sku_id_default,
                                    "title": p.title,
                                    "price": float(p.sale_price or 0),
                                    "reason": sel.reason or "Selected by AI bundle ranking.",
                                    "imageUrl": p.main_image_url,
                                    "productUrl": p.product_url,
                                    "description": getattr(p, "description_text", None),
                                    "categoryLabel": " / ".join(
                                        [
                                            part
                                            for part in [
                                                getattr(p, "category_name_2", None),
                                                getattr(p, "category_name_3", None),
                                            ]
                                            if part
                                        ]
                                    )
                                    or None,
                                    "specs": getattr(p, "specs", None),
                                }
                            )
                        if not bundle_items:
                            continue
                        plans.append(
                            {
                                "id": _new_id("plan"),
                                "title": option.title or "Recommended Order Bundle",
                                "summary": option.summary
                                or "Bundle built from ranked products and constraints.",
                                "explanation": option.explanation or "",
                                "totalPrice": round(
                                    sum(float(item["price"] or 0) for item in bundle_items),
                                    2,
                                ),
                                "confidence": 0.86,
                                "items": bundle_items,
                            }
                        )
                else:
                    bundle_items, matched_target_count = _build_bundle_items(query_result.products, analysis)
                    bundle_title = "Recommended Order Bundle"
                    if target_labels:
                        bundle_title = " + ".join(target_labels[:3]) + " Bundle"
                    plans.append(
                        {
                            "id": _new_id("plan"),
                            "title": bundle_title,
                            "summary": (
                                f"Matched {matched_target_count}/{len(target_labels)} target categories. "
                                "Bundle built from ranked products."
                            ),
                            "explanation": "",
                            "totalPrice": round(
                                sum(float(item["price"] or 0) for item in bundle_items),
                                2,
                            ),
                            "confidence": 0.82,
                            "items": bundle_items,
                        }
                    )

                plans = plans[:5]
                session["plans"] = plans
                logger.info(
                    "chat.stream plans_ready session_id=%s task_id=%s plans=%s",
                    session_id,
                    task_id,
                    len(plans),
                )
                yield add_timeline("bundle_built", f"Generated {len(plans)} bundle option(s).")
                yield add_timeline("plan_ready", "Prepared order-ready recommendation popup.")
                yield _sse({"type": "plan_ready", "plans": plans})
                assistant_text = (
                    f"I found {len(query_result.products)} products matching your request "
                    f"and built {len(plans)} bundle option(s). "
                    "They are displayed in the results section below."
                )
            else:
                assistant_text = (
                    "I could not find enough matches this round. "
                    "Please relax constraints (style/material/room keywords) and try again."
                )

            assistant_message = {
                "id": _new_id("msg"),
                "role": "assistant",
                "content": assistant_text,
                "createdAt": _now_iso(),
            }
            session["messages"].append(assistant_message)
            yield _sse({"type": "message", "message": assistant_message})
            yield add_timeline("done", "Query pipeline finished.")
            yield _sse({"type": "done"})
            logger.info("chat.stream done session_id=%s task_id=%s", session_id, task_id)
        except Exception as exc:
            logger.exception(
                "chat.stream failed session_id=%s task_id=%s error=%s",
                session_id,
                task_id,
                exc,
            )
            yield add_timeline("error", f"Pipeline failed: {exc}")
            yield _sse({"type": "error", "error": f"Chat pipeline failed: {exc}"})
            yield _sse({"type": "done"})

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/orders/mock", response_model=CreateMockOrderOut)
async def create_mock_order(payload: CreateMockOrderIn) -> CreateMockOrderOut:
    if payload.session_id not in _SESSIONS:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order items are required.")

    total_amount = round(sum(item.price * max(item.quantity, 1) for item in payload.items), 2)
    now = datetime.now(timezone.utc)
    eta = (now + timedelta(days=5)).replace(microsecond=0)
    eta_str = eta.date().isoformat()

    return CreateMockOrderOut(
        order_id=f"ORD-{uuid4().hex[:10].upper()}",
        order_status="confirmed",
        payment_status="paid",
        total_amount=total_amount,
        currency="USD",
        tracking_number=f"TRK{uuid4().hex[:12].upper()}",
        carrier="UPS",
        estimated_delivery_date=eta_str,
        warehouse_note="Packed and waiting for carrier pickup.",
        support_contact="support@nexbuy.example",
        created_at=_now_iso(),
    )
