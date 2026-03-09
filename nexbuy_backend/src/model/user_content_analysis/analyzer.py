import json
from typing import Any

from src.model import ChatMessage, get_llm_client

from .prompt import ANALYSIS_SYSTEM_PROMPT, build_analysis_user_prompt
from .schema import TargetItem, UserContentAnalysisResult


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


async def analyze_user_content(conversation_messages: list[ChatMessage]) -> UserContentAnalysisResult:
    llm_client = get_llm_client("glm")
    messages: list[ChatMessage] = [
        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
        *conversation_messages,
        {"role": "user", "content": build_analysis_user_prompt()},
    ]
    result = await llm_client.chat(messages=messages, temperature=0.1)
    parsed = _extract_json_object(result.content)
    return _normalize(parsed)
