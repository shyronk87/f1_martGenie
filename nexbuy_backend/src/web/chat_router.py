import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from src.model.bundle_composer import compose_bundle_with_ai
from src.model.query_data import query_products_from_analysis
from src.model.user_content_analysis import analyze_user_content_with_debug


router = APIRouter(prefix="/chat", tags=["chat"])


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


_SESSIONS: dict[str, dict[str, Any]] = {}
_TASKS: dict[str, dict[str, str]] = {}
ANALYZE_TIMEOUT_SECONDS = 120
QUERY_TIMEOUT_SECONDS = 20
COMPOSE_TIMEOUT_SECONDS = 120


@router.post("/sessions", response_model=SessionCreateResponse)
async def create_session() -> SessionCreateResponse:
    session_id = _new_id("sess")
    _SESSIONS[session_id] = {"messages": [], "timeline": [], "plans": []}
    return SessionCreateResponse(session_id=session_id)


@router.post("/sessions/{session_id}/messages", response_model=SendMessageResponse, status_code=202)
async def send_message(session_id: str, payload: ChatMessageIn) -> SendMessageResponse:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")

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
async def get_session(session_id: str) -> SessionDumpResponse:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
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
            yield _sse({"type": "message_delta", "delta": "Analyzing your requirements... "})
            yield add_timeline("scan_started", "Started parsing requirements.")

            conversation = [
                {"role": m["role"], "content": m["content"]}
                for m in session["messages"]
                if m.get("role") in {"user", "assistant", "system"}
            ]
            try:
                analysis, analysis_logs = await asyncio.wait_for(
                    analyze_user_content_with_debug(conversation),
                    timeout=ANALYZE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                yield add_timeline("error", "Analysis timeout. Please retry with a shorter message.")
                yield _sse({"type": "error", "error": "Analysis timeout. Please retry."})
                yield _sse({"type": "done"})
                return

            for log in analysis_logs:
                yield add_timeline("scan_progress", log)

            yield add_timeline("scan_progress", "Structured fields extracted.")
            try:
                query_result = await asyncio.wait_for(
                    query_products_from_analysis(analysis, limit=10),
                    timeout=QUERY_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                yield add_timeline("error", "Database query timeout. Please retry.")
                yield _sse({"type": "error", "error": "Query timeout. Please retry."})
                yield _sse({"type": "done"})
                return

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
                try:
                    ai_bundle, bundle_logs = await asyncio.wait_for(
                        compose_bundle_with_ai(analysis, query_result.products),
                        timeout=COMPOSE_TIMEOUT_SECONDS,
                    )
                    for log in bundle_logs:
                        yield add_timeline("bundle_built", log)
                except asyncio.TimeoutError:
                    yield add_timeline("bundle_built", "AI bundle composition timeout, fallback used.")
                    ai_bundle = None

                if ai_bundle is not None and ai_bundle.selections:
                    product_map = {p.sku_id_default: p for p in query_result.products}
                    bundle_items = []
                    matched_target_count = 0
                    for sel in ai_bundle.selections:
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
                            }
                        )
                    matched_target_count = len(bundle_items)
                else:
                    bundle_items, matched_target_count = _build_bundle_items(query_result.products, analysis)

                target_labels = [t.category for t in analysis.target_items if t.category]
                bundle_title = "Recommended Order Bundle"
                bundle_summary = (
                    f"Matched {matched_target_count}/{len(target_labels)} target categories. "
                    "Bundle built from ranked products."
                )
                bundle_explanation = ""
                if ai_bundle is not None and ai_bundle.selections:
                    bundle_title = ai_bundle.title or bundle_title
                    if ai_bundle.summary:
                        bundle_summary = ai_bundle.summary
                    bundle_explanation = ai_bundle.explanation
                elif target_labels:
                    bundle_title = " + ".join(target_labels[:3]) + " Bundle"

                plan = {
                    "id": _new_id("plan"),
                    "title": bundle_title,
                    "summary": bundle_summary,
                    "explanation": bundle_explanation,
                    "totalPrice": round(
                        sum(float(item["price"] or 0) for item in bundle_items),
                        2,
                    ),
                    "confidence": 0.86,
                    "items": bundle_items,
                }
                session["plans"] = [plan]
                yield add_timeline(
                    "bundle_built",
                    f"Bundle built with {len(bundle_items)} items; matched target groups: "
                    f"{matched_target_count}/{len(target_labels)}.",
                )
                yield add_timeline("plan_ready", "Prepared order-ready recommendation popup.")
                yield _sse({"type": "plan_ready", "plans": [plan]})
                assistant_text = query_result.agent_reply or ""
                if bundle_explanation:
                    assistant_text = f"{assistant_text}\n\nWhy this bundle:\n{bundle_explanation}".strip()
                if not assistant_text:
                    assistant_text = f"I found {len(query_result.products)} options and built a bundle for you."
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
        except Exception as exc:
            yield add_timeline("error", f"Pipeline failed: {exc}")
            yield _sse({"type": "error", "error": f"Chat pipeline failed: {exc}"})
            yield _sse({"type": "done"})

    return StreamingResponse(event_generator(), media_type="text/event-stream")
