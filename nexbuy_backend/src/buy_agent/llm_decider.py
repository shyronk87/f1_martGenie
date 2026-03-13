from __future__ import annotations

import json
import re
from dataclasses import dataclass

from src.model import get_llm_client
from src.model.config import model_settings
from src.sell_agent.schema import NegotiationTurn


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)

BUYER_AGENT_SYSTEM_PROMPT = """
You are a buyer-side negotiation agent.
Return JSON only. No markdown.

Schema:
{
  "action": "offer" | "accept_seller_price" | "walk_away",
  "buyer_offer": number | null,
  "rationale": "string",
  "buyer_message": "string"
}

Rules:
1) Respect the buyer constraints exactly.
2) Never propose a buyer_offer above max_acceptable_price.
3) If action is "accept_seller_price", only do so when the seller's latest price is acceptable.
4) If action is "walk_away", buyer_offer must be null.
5) Keep rationale concise and operational.
6) Keep buyer_message natural, persuasive, and specific, like a real shopper talking to a seller.
7) Avoid stiff corporate language such as "proceed to order confirmation", "acceptable boundary", or "current negotiation state".
8) When making an offer, mention a concrete everyday reason when possible: budget, comparing options, needing the deal to make sense, or being ready to buy today.
9) Sound warm, practical, and human. Short sentences are fine, but do not sound robotic.
10) If this is not the first round, acknowledge the seller's latest number before making the next move.
7) Do not output anything except valid JSON.
""".strip()


@dataclass
class BuyerLLMDecision:
    action: str
    buyer_offer: float | None
    rationale: str
    buyer_message: str


def _extract_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()
    match = _JSON_RE.search(text)
    if not match:
        raise ValueError(f"No JSON object in buyer agent output: {raw}")
    return json.loads(match.group(0))


def _safe_float(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def propose_buyer_decision(
    *,
    sku_id_default: str,
    product_title: str,
    list_price: float,
    target_price: float,
    max_acceptable_price: float,
    round_index: int,
    max_rounds: int,
    seller_turn: NegotiationTurn | None,
    transcript_summary: str,
) -> BuyerLLMDecision:
    llm = get_llm_client(
        model_settings.llm_buyer_decision_provider,
        model=model_settings.llm_buyer_decision_model,
    )
    seller_price = None
    seller_decision = None
    seller_message = None
    if seller_turn is not None:
        seller_price = seller_turn.seller_counter_price
        seller_decision = seller_turn.seller_decision
        seller_message = seller_turn.seller_message

    result = await llm.chat(
        messages=[
            {"role": "system", "content": BUYER_AGENT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Generate the next buyer negotiation decision.\n"
                    f"sku_id_default={sku_id_default}\n"
                    f"product_title={product_title}\n"
                    f"list_price={list_price}\n"
                    f"target_price={target_price}\n"
                    f"max_acceptable_price={max_acceptable_price}\n"
                    f"round_index={round_index}\n"
                    f"max_rounds={max_rounds}\n"
                    f"seller_decision={seller_decision}\n"
                    f"seller_price={seller_price}\n"
                    f"seller_message={seller_message or ''}\n"
                    f"transcript_summary={transcript_summary}\n"
                ),
            },
        ],
        temperature=0.2,
        timeout_seconds=model_settings.llm_buyer_decision_timeout_seconds,
    )
    payload = _extract_json(result.content)
    action = str(payload.get("action") or "").strip()
    rationale = str(payload.get("rationale") or "").strip()
    buyer_message = str(payload.get("buyer_message") or "").strip()
    return BuyerLLMDecision(
        action=action,
        buyer_offer=_safe_float(payload.get("buyer_offer")),
        rationale=rationale,
        buyer_message=buyer_message,
    )
