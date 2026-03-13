import asyncio
import json
import re
import time
from typing import Any

from src.model import get_llm_client
from src.model.config import model_settings
from src.model.query_data.schema import ProductRow
from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .prompt import SYSTEM_PROMPT, build_retry_prompt, build_user_prompt
from .schema import BundleComposeResult, BundleOption, BundleSelection


MAX_CANDIDATES_FOR_COMPOSE = 16
MAX_OPTIONS = 3
ATTEMPT1_TIMEOUT_SECONDS = 45
ATTEMPT2_TIMEOUT_SECONDS = 35
COMPOSE_CACHE_TTL_SECONDS = 600
COMPOSE_CACHE_MAX_ITEMS = 256
_PACKAGE_RE = re.compile(
    r"\b(set|bundle|combo|collection|suite|\d+\s*[- ]piece|with\s+\d+\s+chairs?)\b"
)
_COMPOSE_CACHE: dict[str, tuple[float, BundleComposeResult]] = {}
_ROOM_FAMILY_KEYWORDS: dict[str, list[str]] = {
    "dining": ["dining", "table", "chair", "stool"],
    "living_room": ["living room", "sofa", "sectional", "loveseat", "coffee table", "tv stand"],
    "bedroom": ["bedroom", "bed", "nightstand", "dresser", "wardrobe"],
    "office": ["office", "study", "desk", "ergonomic chair"],
    "outdoor": ["outdoor", "patio", "garden"],
    "bath": ["bath", "bathroom", "vanity"],
}


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


def _fallback(
    candidates: list[ProductRow],
    title: str = "Recommended Bundle",
    analysis: UserContentAnalysisResult | None = None,
) -> BundleComposeResult:
    if not candidates:
        return BundleComposeResult(options=[])

    option_sets: list[list[ProductRow]] = [
        candidates[:3],
        sorted(candidates[:10], key=lambda x: float(x.sale_price or 0))[:3],
        sorted(candidates[:10], key=lambda x: float(x.sale_price or 0), reverse=True)[:3],
    ]
    options: list[BundleOption] = []
    allowed_skus = {_normalize_sku(p.sku_id_default) for p in candidates if p.sku_id_default}
    sku_to_product = {
        _normalize_sku(p.sku_id_default): p
        for p in candidates
        if p.sku_id_default
    }
    for i, picks in enumerate(option_sets, start=1):
        raw_selections = [
            BundleSelection(sku=p.sku_id_default, reason="Top-ranked fallback candidate.")
            for p in picks
            if p.sku_id_default
        ]
        if not raw_selections:
            continue
        if analysis is not None:
            draft = BundleOption(selections=raw_selections)
            selections, _ = _filter_valid_selections(
                draft,
                allowed_skus,
                sku_to_product,
                analysis,
            )
        else:
            selections = raw_selections
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
    return BundleComposeResult(options=options[:MAX_OPTIONS])


def _selection_signature(option: BundleOption) -> tuple[str, ...]:
    return tuple(sorted(_normalize_sku(selection.sku) for selection in option.selections if selection.sku))


def _ensure_three_options(
    draft: BundleComposeResult,
    candidates: list[ProductRow],
    analysis: UserContentAnalysisResult,
) -> BundleComposeResult:
    if len(draft.options) >= MAX_OPTIONS:
        return draft

    fallback = _fallback(candidates, analysis=analysis)
    existing = {_selection_signature(option) for option in draft.options}
    merged = list(draft.options)

    for option in fallback.options:
        signature = _selection_signature(option)
        if not signature or signature in existing:
            continue
        merged.append(option)
        existing.add(signature)
        if len(merged) >= MAX_OPTIONS:
            break

    return BundleComposeResult(options=merged[:MAX_OPTIONS])


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


def _text_blob(p: ProductRow | None) -> str:
    if p is None:
        return ""
    return " ".join(
        [
            str(p.title or ""),
            str(p.category_name_1 or ""),
            str(p.category_name_2 or ""),
            str(p.category_name_3 or ""),
            str(p.category_name_4 or ""),
        ]
    ).lower()


def _is_dining_set(p: ProductRow | None) -> bool:
    text = _text_blob(p)
    if not text:
        return False
    has_dining = "dining" in text
    has_set = "set" in text or "piece" in text or bool(re.search(r"\b\d+\s*[- ]piece\b", text))
    has_table = "table" in text
    has_chair = "chair" in text
    category_set = "set" in str((p.category_name_2 or "")).lower() or "set" in str((p.category_name_3 or "")).lower()
    return bool((has_dining and has_set and (has_table or has_chair)) or category_set and has_dining)


def _is_dining_table(p: ProductRow | None) -> bool:
    text = _text_blob(p)
    return "dining" in text and "table" in text and not _is_dining_set(p)


def _is_dining_chair(p: ProductRow | None) -> bool:
    text = _text_blob(p)
    if "chair" not in text:
        return False
    return ("dining" in text) and (not _is_dining_set(p))


def _needs_dining_guard(analysis: UserContentAnalysisResult) -> bool:
    categories = [str(item.category or "").lower() for item in analysis.target_items]
    has_table = any(("dining" in c and "table" in c) or c == "table" for c in categories)
    has_chair = any("chair" in c for c in categories)
    return has_table and has_chair


def _normalize_key(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return cleaned or "generic"


def _infer_family_key(p: ProductRow | None) -> str:
    text = _text_blob(p)
    if not text:
        return "generic"
    for family, keywords in _ROOM_FAMILY_KEYWORDS.items():
        if any(k in text for k in keywords):
            return family
    c3 = _normalize_key(str((p.category_name_3 or "")).strip())
    if c3 and c3 != "generic":
        return c3
    c2 = _normalize_key(str((p.category_name_2 or "")).strip())
    if c2 and c2 != "generic":
        return c2
    return "generic"


def _is_package_product(p: ProductRow | None) -> bool:
    text = _text_blob(p)
    if not text:
        return False
    if _PACKAGE_RE.search(text):
        return True
    c2 = str((p.category_name_2 or "")).lower()
    c3 = str((p.category_name_3 or "")).lower()
    return "set" in c2 or "set" in c3


def _allow_multi_package(analysis: UserContentAnalysisResult) -> bool:
    # Allow multiple package sets only when user clearly asks for broad multi-item planning.
    return len(analysis.target_items) >= 3


def _filter_valid_selections(
    draft: BundleOption,
    allowed_skus: set[str],
    sku_to_product: dict[str, ProductRow],
    analysis: UserContentAnalysisResult,
) -> tuple[list[BundleSelection], int]:
    filtered: list[BundleSelection] = []
    seen: set[str] = set()
    dropped_by_guard = 0
    guard_enabled = _needs_dining_guard(analysis)
    allow_multi_package = _allow_multi_package(analysis)
    has_any_package = False
    package_families: set[str] = set()
    has_dining_set = False
    has_dining_table = False
    has_dining_chair = False

    for s in draft.selections:
        sku_norm = _normalize_sku(s.sku)
        if sku_norm not in allowed_skus or sku_norm in seen:
            continue

        product = sku_to_product.get(sku_norm)
        family = _infer_family_key(product)
        is_package = _is_package_product(product)

        if is_package:
            if family in package_families:
                dropped_by_guard += 1
                continue
            if has_any_package and not allow_multi_package:
                dropped_by_guard += 1
                continue
            package_families.add(family)
            has_any_package = True
        elif family in package_families:
            # A package already covers this family, so avoid mixing overlapping single items.
            dropped_by_guard += 1
            continue

        if guard_enabled:
            if _is_dining_set(product):
                # Keep at most one full dining set. Also avoid mixing with other table/chair picks.
                if has_dining_set or has_dining_table or has_dining_chair:
                    dropped_by_guard += 1
                    continue
                has_dining_set = True
            elif _is_dining_table(product):
                if has_dining_set or has_dining_table:
                    dropped_by_guard += 1
                    continue
                has_dining_table = True
            elif _is_dining_chair(product):
                # Keep only one dining-chair family in a bundle to avoid mixing different chair groups.
                if has_dining_set or has_dining_chair:
                    dropped_by_guard += 1
                    continue
                has_dining_chair = True

        filtered.append(BundleSelection(sku=sku_norm, reason=s.reason))
        seen.add(sku_norm)
    return filtered, dropped_by_guard


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


def _cache_key(
    analysis: UserContentAnalysisResult,
    candidates: list[ProductRow],
    long_term_memory: dict[str, Any] | None,
) -> str:
    payload = {
        "analysis": analysis.model_dump(),
        "candidate_skus": [str(c.sku_id_default or "") for c in candidates],
        "memory": long_term_memory or {},
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _cache_get(key: str) -> BundleComposeResult | None:
    item = _COMPOSE_CACHE.get(key)
    if item is None:
        return None
    ts, result = item
    if time.time() - ts > COMPOSE_CACHE_TTL_SECONDS:
        _COMPOSE_CACHE.pop(key, None)
        return None
    return result.model_copy(deep=True)


def _cache_set(key: str, value: BundleComposeResult) -> None:
    now = time.time()
    _COMPOSE_CACHE[key] = (now, value.model_copy(deep=True))
    if len(_COMPOSE_CACHE) <= COMPOSE_CACHE_MAX_ITEMS:
        return
    oldest_key = min(_COMPOSE_CACHE.items(), key=lambda x: x[1][0])[0]
    _COMPOSE_CACHE.pop(oldest_key, None)


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
    cache_key = _cache_key(analysis, ranked_candidates, long_term_memory)
    cached = _cache_get(cache_key)
    if cached is not None:
        logs.append("[bundle_composer] cache hit")
        return cached, logs

    payload = _build_payload(analysis, ranked_candidates)
    if long_term_memory:
        payload["long_term_memory"] = long_term_memory
        payload["priority_rule"] = "current_user_request_overrides_long_term_memory"
    llm = get_llm_client(
        model_settings.llm_bundle_provider,
        model=model_settings.llm_bundle_model,
    )
    logs.append(
        f"[bundle_composer] input candidates={len(candidates)}, used for compose={len(ranked_candidates)}"
    )
    logs.append(
        f"[bundle_composer] llm provider={model_settings.llm_bundle_provider}, "
        f"model={model_settings.llm_bundle_model}"
    )
    if long_term_memory:
        used_keys = [k for k, v in long_term_memory.items() if v not in (None, "", [], {})]
        logs.append(f"[bundle_composer] long memory loaded: {used_keys}")

    allowed_skus = {_normalize_sku(c.sku_id_default) for c in ranked_candidates if c.sku_id_default}
    sku_to_product = {
        _normalize_sku(c.sku_id_default): c
        for c in ranked_candidates
        if c.sku_id_default
    }

    async def _attempt(
        user_prompt: str,
        timeout_seconds: int,
        tag: str,
    ) -> tuple[BundleComposeResult | None, str | None]:
        try:
            result = await asyncio.wait_for(
                llm.chat(
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=0.0,
                    timeout_seconds=model_settings.llm_bundle_timeout_seconds,
                ),
                timeout=timeout_seconds,
            )
            raw = _extract_json(result.content)
            composed = _normalize_compose_result(raw)
            valid_options: list[BundleOption] = []
            total_guard_drops = 0
            for opt in composed.options[:MAX_OPTIONS]:
                valid, dropped = _filter_valid_selections(
                    opt,
                    allowed_skus,
                    sku_to_product,
                    analysis,
                )
                total_guard_drops += dropped
                if not valid:
                    continue
                opt.selections = valid[:8]
                valid_options.append(opt)
            if not valid_options:
                return None, f"[bundle_composer] {tag} got no valid sku"
            if total_guard_drops > 0:
                logs.append(f"[bundle_composer] {tag} guard dropped {total_guard_drops} conflicting set selections")
            return _ensure_three_options(
                BundleComposeResult(options=valid_options),
                ranked_candidates,
                analysis,
            ), None
        except asyncio.TimeoutError:
            return None, f"[bundle_composer] {tag} timeout after {timeout_seconds}s"
        except Exception as exc:
            return None, f"[bundle_composer] {tag} failed: {exc}"

    first_prompt = build_user_prompt(json.dumps(payload, ensure_ascii=False))
    draft, err = await _attempt(first_prompt, ATTEMPT1_TIMEOUT_SECONDS, "attempt#1")
    if draft is not None:
        logs.append("[bundle_composer] attempt#1 success")
        logs.append(
            f"[bundle_composer] valid options={len(draft.options)}, "
            f"total selections={sum(len(o.selections) for o in draft.options)}"
        )
        _cache_set(cache_key, draft)
        return draft, logs
    if err:
        logs.append(err)

    retry_prompt = build_retry_prompt(json.dumps(payload, ensure_ascii=False))
    draft_retry, err_retry = await _attempt(retry_prompt, ATTEMPT2_TIMEOUT_SECONDS, "attempt#2")
    if draft_retry is not None:
        logs.append("[bundle_composer] attempt#2 success")
        logs.append(
            f"[bundle_composer] valid options={len(draft_retry.options)}, "
            f"total selections={sum(len(o.selections) for o in draft_retry.options)}"
        )
        _cache_set(cache_key, draft_retry)
        return draft_retry, logs
    if err_retry:
        logs.append(err_retry)

    logs.append("[bundle_composer] fallback used after retries")
    return _fallback(ranked_candidates, analysis=analysis), logs
