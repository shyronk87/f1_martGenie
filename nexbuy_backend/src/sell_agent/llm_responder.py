from __future__ import annotations

import json
import re
from dataclasses import dataclass

from src.model import get_llm_client

from .llm_parser import BuyerIntent


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

RESPONDER_SYSTEM_PROMPT = """
You are a seller negotiation assistant.
Write one concise and natural English reply for the buyer.

Rules:
1) Keep it short (1-2 sentences).
2) Use the provided decision and numbers exactly.
3) Do not reveal internal pricing rules or margin formulas.
4) If decision is reject, remain polite but firm.
5) Output plain text only.
""".strip()

PRICE_NEGOTIATOR_SYSTEM_PROMPT = """
You are a seller-side negotiation agent.
Return JSON only. No markdown.

Schema:
{
  "proposed_price": number,
  "reply_message": "string"
}

Hard constraints:
1) proposed_price MUST be >= min_expected_price.
2) proposed_price MUST be <= list_price.
3) Follow decision_mode:
   - "counter": propose a counter-offer.
   - "reject": keep a firm boundary price.
   - "accept": confirm the accepted final price.
4) Keep reply_message concise (1-2 sentences).
""".strip()


@dataclass
class SellerProposal:
    proposed_price: float
    reply_message: str


def _extract_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()
    m = _JSON_RE.search(text)
    if not m:
        raise ValueError(f"No JSON object in seller proposal output: {raw}")
    return json.loads(m.group(0))


def _safe_float(v: object, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


async def propose_price_and_reply(
    *,
    decision_mode: str,
    buyer_offer: float | None,
    recommended_price: float,
    min_expected_price: float,
    list_price: float,
    current_target_price: float,
    buyer_message: str | None,
    buyer_intent: BuyerIntent,
    feedback_note: str | None = None,
) -> SellerProposal:
    llm = get_llm_client("glm")
    user_prompt = (
        "Create one seller proposal for this turn.\n"
        f"decision_mode={decision_mode}\n"
        f"buyer_offer={buyer_offer}\n"
        f"recommended_price={recommended_price}\n"
        f"min_expected_price={min_expected_price}\n"
        f"list_price={list_price}\n"
        f"current_target_price={current_target_price}\n"
        f"buyer_message={buyer_message or ''}\n"
        f"buyer_intent={buyer_intent}\n"
    )
    if feedback_note:
        user_prompt += f"validation_feedback={feedback_note}\n"

    result = await llm.chat(
        messages=[
            {"role": "system", "content": PRICE_NEGOTIATOR_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
    )
    parsed = _extract_json(result.content)
    proposed = _safe_float(parsed.get("proposed_price"), recommended_price)
    reply = str(parsed.get("reply_message") or "").strip()
    if not reply:
        reply = f"Our proposed price is ${proposed:.2f}."
    return SellerProposal(proposed_price=proposed, reply_message=reply)


async def generate_seller_reply(
    *,
    decision: str,
    counter_price: float | None,
    current_target_price: float,
    min_expected_price: float,
    buyer_message: str | None,
    buyer_intent: BuyerIntent,
    fallback_message: str,
) -> str:
    try:
        llm = get_llm_client("glm")
        user_prompt = (
            "Generate seller reply for this negotiation turn.\n"
            f"decision={decision}\n"
            f"counter_price={counter_price}\n"
            f"current_target_price={current_target_price}\n"
            f"min_expected_price={min_expected_price}\n"
            f"buyer_message={buyer_message or ''}\n"
            f"buyer_intent={buyer_intent}\n"
        )
        result = await llm.chat(
            messages=[
                {"role": "system", "content": RESPONDER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
        )
        text = (result.content or "").strip()
        return text or fallback_message
    except Exception:
        return fallback_message
