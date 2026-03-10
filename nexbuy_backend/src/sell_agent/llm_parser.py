from __future__ import annotations

import json
import re
from dataclasses import dataclass

from src.model import get_llm_client


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)
_PRICE_RE = re.compile(r"\$?\s*([0-9]+(?:\.[0-9]{1,2})?)")

PARSER_SYSTEM_PROMPT = """
You are a buyer-intent parser for negotiation.
Return JSON only. No markdown.

Required JSON schema:
{
  "detected_offer": number|null,
  "budget_hint": number|null,
  "willingness_level": "low"|"medium"|"high",
  "accept_counter_signal": true|false|null,
  "urgency_signal": "low"|"medium"|"high"
}
""".strip()


@dataclass
class BuyerIntent:
    detected_offer: float | None = None
    budget_hint: float | None = None
    willingness_level: str = "medium"
    accept_counter_signal: bool | None = None
    urgency_signal: str = "medium"


def _extract_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()
    m = _JSON_RE.search(text)
    if not m:
        raise ValueError(f"No JSON object in parser output: {raw}")
    return json.loads(m.group(0))


def _safe_float(v: object) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _normalize_level(v: object, allowed: set[str], default: str) -> str:
    s = str(v or "").strip().lower()
    return s if s in allowed else default


def _fallback_intent_from_text(message: str) -> BuyerIntent:
    detected_offer = None
    m = _PRICE_RE.search(message or "")
    if m:
        detected_offer = _safe_float(m.group(1))
    return BuyerIntent(detected_offer=detected_offer)


async def parse_buyer_intent(message: str) -> BuyerIntent:
    text = (message or "").strip()
    if not text:
        return BuyerIntent()

    try:
        llm = get_llm_client("glm")
        result = await llm.chat(
            messages=[
                {"role": "system", "content": PARSER_SYSTEM_PROMPT},
                {"role": "user", "content": f"Buyer message:\n{text}"},
            ],
            temperature=0.0,
        )
        parsed = _extract_json(result.content)
        return BuyerIntent(
            detected_offer=_safe_float(parsed.get("detected_offer")),
            budget_hint=_safe_float(parsed.get("budget_hint")),
            willingness_level=_normalize_level(
                parsed.get("willingness_level"),
                {"low", "medium", "high"},
                "medium",
            ),
            accept_counter_signal=(
                parsed.get("accept_counter_signal")
                if isinstance(parsed.get("accept_counter_signal"), bool)
                else None
            ),
            urgency_signal=_normalize_level(
                parsed.get("urgency_signal"),
                {"low", "medium", "high"},
                "medium",
            ),
        )
    except Exception:
        return _fallback_intent_from_text(text)
