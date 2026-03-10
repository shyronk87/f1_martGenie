import json
from typing import Any

from src.model import get_llm_client
from src.model.query_data.schema import ProductRow
from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .prompt import SYSTEM_PROMPT, build_retry_prompt, build_user_prompt
from .schema import BundleComposeResult, BundleOption, BundleSelection


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
    if not candidates:
        return BundleComposeResult(options=[])

    option_sets: list[list[ProductRow]] = [
        candidates[:3],
        sorted(candidates[:10], key=lambda x: float(x.sale_price or 0))[:3],
        sorted(candidates[:10], key=lambda x: float(x.sale_price or 0), reverse=True)[:3],
    ]
    options: list[BundleOption] = []
    for i, picks in enumerate(option_sets, start=1):
        selections = [
            BundleSelection(sku=p.sku_id_default, reason="Top-ranked fallback candidate.")
            for p in picks
            if p.sku_id_default
        ]
        if not selections:
            continue
        options.append(
            BundleOption(
                title=f"{title} #{i}",
                summary="Fallback bundle from ranked candidates.",
                explanation=(
                    "AI bundle composition failed validation, so this bundle was auto-built "
                    "from the current ranked results."
                ),
                selections=selections,
            )
        )
    return BundleComposeResult(options=options[:5])


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
    draft: BundleOption,
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


def _normalize_compose_result(raw: dict[str, Any]) -> BundleComposeResult:
    if "options" in raw and isinstance(raw.get("options"), list):
        return BundleComposeResult(**raw)
    # Backward compatibility for single-option format.
    single = BundleOption(
        title=str(raw.get("title") or "Recommended Bundle"),
        summary=str(raw.get("summary") or ""),
        explanation=str(raw.get("explanation") or ""),
        selections=[BundleSelection(**s) for s in (raw.get("selections") or []) if isinstance(s, dict)],
    )
    return BundleComposeResult(options=[single])


async def compose_bundle_with_ai(
    analysis: UserContentAnalysisResult,
    candidates: list[ProductRow],
    *,
    long_term_memory: dict[str, Any] | None = None,
) -> tuple[BundleComposeResult, list[str]]:
    logs: list[str] = []
    if not candidates:
        return BundleComposeResult(summary="No candidates to compose."), ["[bundle_composer] no candidates"]

    ranked_candidates = _prepare_candidates(candidates)
    payload = _build_payload(analysis, ranked_candidates)
    if long_term_memory:
        payload["long_term_memory"] = long_term_memory
        payload["priority_rule"] = "current_user_request_overrides_long_term_memory"
    llm = get_llm_client("glm")
    logs.append(
        f"[bundle_composer] input candidates={len(candidates)}, used for compose={len(ranked_candidates)}"
    )
    if long_term_memory:
        used_keys = [k for k, v in long_term_memory.items() if v not in (None, "", [], {})]
        logs.append(f"[bundle_composer] long memory loaded: {used_keys}")

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
            composed = _normalize_compose_result(raw)
            valid_options: list[BundleOption] = []
            for opt in composed.options[:5]:
                valid = _filter_valid_selections(opt, allowed_skus)
                if not valid:
                    continue
                opt.selections = valid[:8]
                valid_options.append(opt)
            if not valid_options:
                return None, f"[bundle_composer] {tag} got no valid sku"
            return BundleComposeResult(options=valid_options), None
        except Exception as exc:
            return None, f"[bundle_composer] {tag} failed: {exc}"

    first_prompt = build_user_prompt(json.dumps(payload, ensure_ascii=False))
    draft, err = await _attempt(first_prompt, 0.1, "attempt#1")
    if draft is not None:
        logs.append("[bundle_composer] attempt#1 success")
        logs.append(
            f"[bundle_composer] valid options={len(draft.options)}, "
            f"total selections={sum(len(o.selections) for o in draft.options)}"
        )
        return draft, logs
    if err:
        logs.append(err)

    retry_prompt = build_retry_prompt(json.dumps(payload, ensure_ascii=False))
    draft_retry, err_retry = await _attempt(retry_prompt, 0.0, "attempt#2")
    if draft_retry is not None:
        logs.append("[bundle_composer] attempt#2 success")
        logs.append(
            f"[bundle_composer] valid options={len(draft_retry.options)}, "
            f"total selections={sum(len(o.selections) for o in draft_retry.options)}"
        )
        return draft_retry, logs
    if err_retry:
        logs.append(err_retry)

    logs.append("[bundle_composer] fallback used after retries")
    return _fallback(ranked_candidates), logs
