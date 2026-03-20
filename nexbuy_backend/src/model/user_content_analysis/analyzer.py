import json
import time
from typing import Any

from src.model import ChatMessage, get_llm_client
from src.model.config import model_settings

from .prompt import ANALYSIS_SYSTEM_PROMPT, build_analysis_user_prompt
from .schema import TargetItem, UserContentAnalysisResult

MAX_ANALYSIS_MESSAGES = 4
MAX_MEMORY_LIST_ITEMS = 4


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"LLM output does not contain JSON object: {raw_text}")

    payload = text[start : end + 1]
    return json.loads(payload)


def _normalize(parsed: dict[str, Any]) -> UserContentAnalysisResult:
    items_raw = parsed.get("target_items") or []
    items: list[TargetItem] = []
    if isinstance(items_raw, list):
        for item in items_raw:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "").strip()
            if not category:
                continue
            quantity = item.get("quantity", 1)
            try:
                quantity_int = int(quantity)
            except (TypeError, ValueError):
                quantity_int = 1
            quantity_int = max(1, quantity_int)

            budget_raw = item.get("item_budget_allocation")
            item_budget: float | None
            if budget_raw in (None, ""):
                item_budget = None
            else:
                try:
                    item_budget = float(budget_raw)
                except (TypeError, ValueError):
                    item_budget = None

            features_raw = item.get("specific_features") or []
            features: list[str] = []
            if isinstance(features_raw, list):
                for f in features_raw:
                    f_str = str(f).strip()
                    if f_str:
                        features.append(f_str)

            items.append(
                TargetItem(
                    category=category,
                    quantity=quantity_int,
                    item_budget_allocation=item_budget,
                    specific_features=features,
                )
            )

    budget_raw = parsed.get("total_budget")
    total_budget: float | None
    if budget_raw in (None, ""):
        total_budget = None
    else:
        try:
            total_budget = float(budget_raw)
        except (TypeError, ValueError):
            total_budget = None

    if total_budget is None and items:
        item_budgets = [item.item_budget_allocation for item in items if item.item_budget_allocation is not None]
        if len(items) == 1 and len(item_budgets) == 1:
            total_budget = float(item_budgets[0])
        elif len(item_budgets) == len(items):
            total_budget = float(sum(item_budgets))

    style_preference = parsed.get("style_preference")
    style = str(style_preference).strip() if style_preference is not None else None
    if style == "":
        style = None

    room_type_raw = parsed.get("room_type")
    room_type = str(room_type_raw).strip() if room_type_raw is not None else None
    if room_type == "":
        room_type = None

    currency_raw = str(parsed.get("currency") or "USD").strip()
    currency = currency_raw or "USD"

    constraints_raw = parsed.get("hard_constraints") or []
    hard_constraints: list[str] = []
    if isinstance(constraints_raw, list):
        for c in constraints_raw:
            c_str = str(c).strip()
            if c_str:
                hard_constraints.append(c_str)

    missing_fields: list[str] = []
    if total_budget is None:
        missing_fields.append("total_budget")
    if style is None:
        missing_fields.append("style_preference")
    if not items:
        missing_fields.append("target_items")

    is_ready = len(missing_fields) == 0
    agent_reply = str(parsed.get("agent_reply") or "").strip()

    return UserContentAnalysisResult(
        total_budget=total_budget,
        currency=currency,
        style_preference=style,
        room_type=room_type,
        hard_constraints=hard_constraints,
        target_items=items,
        is_ready=is_ready,
        missing_fields=missing_fields,
        agent_reply=agent_reply,
    )


def _compact_conversation_messages(
    conversation_messages: list[ChatMessage],
) -> list[ChatMessage]:
    filtered = [
        {
            "role": msg["role"],
            "content": str(msg["content"]).strip(),
        }
        for msg in conversation_messages
        if msg.get("role") in {"user", "assistant"} and str(msg.get("content") or "").strip()
    ]
    return filtered[-MAX_ANALYSIS_MESSAGES:]


def _compact_long_term_memory(long_term_memory: dict[str, Any] | None) -> dict[str, Any] | None:
    if not long_term_memory:
        return None

    compact: dict[str, Any] = {}
    for key, value in long_term_memory.items():
        if key == "raw_answers":
            continue
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            compact[key] = value[:MAX_MEMORY_LIST_ITEMS]
        else:
            compact[key] = value
    return compact or None


async def analyze_user_content(conversation_messages: list[ChatMessage]) -> UserContentAnalysisResult:
    result, _ = await analyze_user_content_with_debug(conversation_messages)
    return result


async def analyze_user_content_with_debug(
    conversation_messages: list[ChatMessage],
    long_term_memory: dict[str, Any] | None = None,
) -> tuple[UserContentAnalysisResult, list[str]]:
    logs: list[str] = []
    t0 = time.perf_counter()
    logs.append(f"[user_content_analysis] input messages={len(conversation_messages)}")
    compact_memory = _compact_long_term_memory(long_term_memory)
    compact_messages = _compact_conversation_messages(conversation_messages)
    logs.append(f"[user_content_analysis] compacted messages={len(compact_messages)}")
    if compact_memory:
        used_keys = [k for k, v in compact_memory.items() if v not in (None, "", [], {})]
        logs.append(f"[user_content_analysis] long memory loaded: {used_keys}")

    llm_client = get_llm_client(
        model_settings.llm_analysis_provider,
        model=model_settings.llm_analysis_model,
    )
    logs.append("[user_content_analysis] LLM client initialized")
    logs.append(
        f"[user_content_analysis] llm provider={model_settings.llm_analysis_provider}, "
        f"model={model_settings.llm_analysis_model}"
    )
    messages: list[ChatMessage] = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
    ]
    if compact_memory:
        memory_block = json.dumps(compact_memory, ensure_ascii=False)
        messages.append(
            {
                "role": "system",
                "content": (
                    "Long-term user memory (use as default preference, not as hard override):\n"
                    f"{memory_block}\n"
                    "Priority rule: explicit current user request overrides long-term memory."
                ),
            }
        )
    messages.extend(
        [
        *compact_messages,
        {"role": "user", "content": build_analysis_user_prompt()},
        ]
    )
    t_llm = time.perf_counter()
    result = await llm_client.chat(
        messages=messages,
        temperature=0.1,
        timeout_seconds=model_settings.llm_analysis_timeout_seconds,
    )
    logs.append(
        f"[user_content_analysis] LLM response received in {(time.perf_counter() - t_llm):.2f}s"
    )
    parsed = _extract_json_object(result.content)
    logs.append("[user_content_analysis] JSON parsed")
    normalized = _normalize(parsed)
    if compact_memory:
        used_defaults: list[str] = []
        memory_styles = [
            str(v).strip()
            for v in (compact_memory.get("style_preferences") or [])
            if str(v).strip()
        ]
        memory_rooms = [
            str(v).strip()
            for v in (compact_memory.get("room_priorities") or [])
            if str(v).strip()
        ]
        memory_constraints = [
            str(v).strip()
            for v in (compact_memory.get("negative_constraints") or [])
            if str(v).strip()
        ]
        household = {
            str(v).strip().lower()
            for v in (compact_memory.get("household_members") or [])
            if str(v).strip()
        }
        if "cat" in household:
            memory_constraints.append("pet-friendly for cats")
        if "dog" in household:
            memory_constraints.append("pet-friendly for dogs")

        # Current-turn explicit values always win. Long memory only fills missing fields.
        if normalized.style_preference is None and memory_styles:
            normalized.style_preference = memory_styles[0]
            used_defaults.append("style_preferences->style_preference")
        if normalized.room_type is None and memory_rooms:
            normalized.room_type = memory_rooms[0]
            used_defaults.append("room_priorities->room_type")
        if not normalized.hard_constraints and memory_constraints:
            normalized.hard_constraints = memory_constraints
            used_defaults.append("negative_constraints/household_members->hard_constraints")

        if used_defaults:
            if (
                normalized.total_budget is not None
                and normalized.style_preference is not None
                and normalized.target_items
            ):
                normalized.is_ready = True
                normalized.missing_fields = []
            logs.append(f"[user_content_analysis] applied memory defaults: {used_defaults}")
        else:
            logs.append("[user_content_analysis] memory loaded but no default field was applied")

    logs.append(
        f"[user_content_analysis] normalized: ready={normalized.is_ready}, "
        f"missing={normalized.missing_fields}, items={len(normalized.target_items)}"
    )
    logs.append(f"[user_content_analysis] done in {(time.perf_counter() - t0):.2f}s")
    return normalized, logs
