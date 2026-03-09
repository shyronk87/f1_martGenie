import json
from typing import Any

from src.model import get_llm_client
from src.model.query_data.schema import ProductRow
from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .prompt import SYSTEM_PROMPT, build_retry_prompt, build_user_prompt
from .schema import BundleComposeResult, BundleSelection


MAX_CANDIDATES_FOR_COMPOSE = 24


def _extract_json(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.replace("json", "", 1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"Bundle LLM output does not contain JSON object: {raw_text}")
    return json.loads(text[start : end + 1])


def _fallback(candidates: list[ProductRow], title: str = "Recommended Bundle") -> BundleComposeResult:
    picks = candidates[:3]
    return BundleComposeResult(
        title=title,
        summary="Fallback bundle from top-ranked candidates.",
        explanation=(
            "The AI bundle composer failed to return a valid structured response. "
            "Using top-ranked products as a safe fallback."
        ),
        selections=[
            BundleSelection(sku=p.sku_id_default, reason="Top-ranked candidate.")
            for p in picks
            if p.sku_id_default
        ],
    )


def _normalize_sku(value: str) -> str:
    return value.strip().upper()


def _prepare_candidates(candidates: list[ProductRow]) -> list[ProductRow]:
    # Keep only top-ranked candidates to reduce token usage and hallucination risk.
    return candidates[:MAX_CANDIDATES_FOR_COMPOSE]


def _build_payload(analysis: UserContentAnalysisResult, candidates: list[ProductRow]) -> dict[str, Any]:
    candidate_rows = []
    for c in candidates:
        candidate_rows.append(
            {
                "sku": c.sku_id_default,
                "title": c.title,
                "category_name_1": c.category_name_1,
                "category_name_2": c.category_name_2,
                "category_name_3": c.category_name_3,
                "sale_price": c.sale_price,
                "stock_status_text": c.stock_status_text,
            }
        )
    return {
        "user_requirements": analysis.model_dump(),
        "allowed_skus": [c.sku_id_default for c in candidates if c.sku_id_default],
        "candidates": candidate_rows,
    }


def _filter_valid_selections(
    draft: BundleComposeResult,
    allowed_skus: set[str],
) -> list[BundleSelection]:
    filtered: list[BundleSelection] = []
    seen: set[str] = set()
    for s in draft.selections:
        sku_norm = _normalize_sku(s.sku)
        if sku_norm not in allowed_skus or sku_norm in seen:
            continue
        filtered.append(BundleSelection(sku=sku_norm, reason=s.reason))
        seen.add(sku_norm)
    return filtered


async def compose_bundle_with_ai(
    analysis: UserContentAnalysisResult,
    candidates: list[ProductRow],
) -> tuple[BundleComposeResult, list[str]]:
    logs: list[str] = []
    if not candidates:
        return BundleComposeResult(summary="No candidates to compose."), ["[bundle_composer] no candidates"]

    ranked_candidates = _prepare_candidates(candidates)
    payload = _build_payload(analysis, ranked_candidates)
    llm = get_llm_client("glm")
    logs.append(
        f"[bundle_composer] input candidates={len(candidates)}, used for compose={len(ranked_candidates)}"
    )

    allowed_skus = {_normalize_sku(c.sku_id_default) for c in ranked_candidates if c.sku_id_default}

    async def _attempt(user_prompt: str, temperature: float, tag: str) -> tuple[BundleComposeResult | None, str | None]:
        try:
            result = await llm.chat(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=temperature,
            )
            raw = _extract_json(result.content)
            draft = BundleComposeResult(**raw)
            valid = _filter_valid_selections(draft, allowed_skus)
            if not valid:
                return None, f"[bundle_composer] {tag} got no valid sku"
            draft.selections = valid[:8]
            return draft, None
        except Exception as exc:
            return None, f"[bundle_composer] {tag} failed: {exc}"

    first_prompt = build_user_prompt(json.dumps(payload, ensure_ascii=False))
    draft, err = await _attempt(first_prompt, 0.1, "attempt#1")
    if draft is not None:
        logs.append("[bundle_composer] attempt#1 success")
        logs.append(f"[bundle_composer] valid selections={len(draft.selections)}")
        return draft, logs
    if err:
        logs.append(err)

    retry_prompt = build_retry_prompt(json.dumps(payload, ensure_ascii=False))
    draft_retry, err_retry = await _attempt(retry_prompt, 0.0, "attempt#2")
    if draft_retry is not None:
        logs.append("[bundle_composer] attempt#2 success")
        logs.append(f"[bundle_composer] valid selections={len(draft_retry.selections)}")
        return draft_retry, logs
    if err_retry:
        logs.append(err_retry)

    logs.append("[bundle_composer] fallback used after retries")
    return _fallback(ranked_candidates), logs
