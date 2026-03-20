import asyncio
import json
import re
import time
from typing import Any

from src.model import get_llm_client
from src.model.config import model_settings
from src.model.query_data.schema import ProductRow
from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .schema import BundleComposeResult, BundleOption, BundleSelection


MAX_CANDIDATES_FOR_COMPOSE = 16
MAX_OPTIONS = 3
COMPOSE_CACHE_TTL_SECONDS = 600
COMPOSE_CACHE_MAX_ITEMS = 256
_PACKAGE_RE = re.compile(
    r"\b(set|bundle|combo|collection|suite|\d+\s*[- ]piece|with\s+\d+\s+chairs?)\b"
)
_INTERNAL_CODE_RE = re.compile(
    r"\b(?:sku|spu|product\s*id|item\s*id|id)\s*[:#-]?\s*[a-z0-9_-]+\b|"
    r"\b(?=[a-z0-9_-]*[a-z])[a-z]{0,3}\d{4,}[a-z0-9_-]*\b|"
    r"(?<!\$)\b\d{5,}\b(?!\.\d)",
    re.IGNORECASE,
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
REASONING_SYSTEM_PROMPT = """
You write concise user-facing bundle rationale for furniture recommendations.
Return ONLY valid JSON with this schema:
{
  "options": [
    {
      "title": "string",
      "summary": "string",
      "explanation": "string",
      "selection_reasons": ["string"]
    }
  ]
}

Rules:
1) Keep the same number of options and same item order as the input.
2) Do not mention SKU, SPU, IDs, raw codes, or internal numbers.
3) title should be short and clear.
4) summary should be one short sentence.
5) explanation should be 2 to 3 short sentences and explain fit, budget, and tradeoffs.
6) selection_reasons length must match the number of items in that option.
7) selection_reasons should be short plain-language reasons for each item.
""".strip()


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


def _pick_distinct_products(
    products: list[ProductRow],
    *,
    limit: int,
    prefer_low_price: bool = False,
    prefer_high_price: bool = False,
) -> list[ProductRow]:
    ranked = list(products[:])
    if prefer_low_price:
        ranked = sorted(ranked, key=lambda item: float(item.sale_price or 0))
    elif prefer_high_price:
        ranked = sorted(ranked, key=lambda item: float(item.sale_price or 0), reverse=True)

    chosen: list[ProductRow] = []
    seen_family: set[str] = set()
    seen_sku: set[str] = set()
    for product in ranked:
        sku = _normalize_sku(str(product.sku_id_default or ""))
        if not sku or sku in seen_sku:
            continue
        family = _infer_family_key(product)
        if family in seen_family:
            continue
        chosen.append(product)
        seen_sku.add(sku)
        seen_family.add(family)
        if len(chosen) >= limit:
            break
    return chosen


def _build_heuristic_bundles(
    candidates: list[ProductRow],
    analysis: UserContentAnalysisResult,
) -> BundleComposeResult:
    if not candidates:
        return BundleComposeResult(options=[])

    strategies = [
        (
            "Best overall fit",
            "Balances coverage, style fit, and availability.",
            "This set stays closest to the main request while keeping the mix practical and easy to order.",
            {},
        ),
        (
            "Best value",
            "Keeps the overall spend tighter.",
            "This set leans toward stronger price efficiency while still covering the main product needs.",
            {"prefer_low_price": True},
        ),
        (
            "Higher-spec pick",
            "Pushes quality and visual impact a bit more.",
            "This set uses some stronger premium picks for a more polished result, with a slightly less price-sensitive mix.",
            {"prefer_high_price": True},
        ),
    ]

    allowed_skus = {_normalize_sku(p.sku_id_default) for p in candidates if p.sku_id_default}
    sku_to_product = {
        _normalize_sku(p.sku_id_default): p
        for p in candidates
        if p.sku_id_default
    }
    options: list[BundleOption] = []
    seen_signatures: set[tuple[str, ...]] = set()

    for title, summary, explanation, picker_kwargs in strategies:
        picks = _pick_distinct_products(candidates[:10], limit=3, **picker_kwargs)
        raw_selections = [
            BundleSelection(sku=product.sku_id_default, reason="Selected for strong fit in this bundle.")
            for product in picks
            if product.sku_id_default
        ]
        draft = BundleOption(
            title=title,
            summary=summary,
            explanation=explanation,
            selections=raw_selections,
        )
        valid, _ = _filter_valid_selections(
            draft,
            allowed_skus,
            sku_to_product,
            analysis,
        )
        if not valid:
            continue
        option = BundleOption(
            title=title,
            summary=summary,
            explanation=explanation,
            selections=valid[:8],
        )
        signature = _selection_signature(option)
        if not signature or signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        options.append(option)

    if not options:
        return _fallback(candidates, analysis=analysis)
    return _ensure_three_options(BundleComposeResult(options=options[:MAX_OPTIONS]), candidates, analysis)


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


def _sanitize_user_facing_text(value: str) -> str:
    cleaned = _INTERNAL_CODE_RE.sub("", value)
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    return cleaned.strip(" ,.;:-")


def _sanitize_compose_result(result: BundleComposeResult) -> BundleComposeResult:
    for option in result.options:
        option.title = _sanitize_user_facing_text(option.title)
        option.summary = _sanitize_user_facing_text(option.summary)
        option.explanation = _sanitize_user_facing_text(option.explanation)
        for selection in option.selections:
            selection.reason = _sanitize_user_facing_text(selection.reason)
    return result


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


def _build_reasoning_payload(
    analysis: UserContentAnalysisResult,
    bundles: BundleComposeResult,
    sku_to_product: dict[str, ProductRow],
) -> dict[str, Any]:
    return {
        "user_requirements": {
            "budget": analysis.total_budget,
            "style_preference": analysis.style_preference,
            "room_type": analysis.room_type,
            "hard_constraints": analysis.hard_constraints,
            "target_items": [item.model_dump() for item in analysis.target_items],
        },
        "options": [
            {
                "title": option.title,
                "items": [
                    {
                        "title": sku_to_product.get(_normalize_sku(selection.sku)).title,
                        "category_name_2": sku_to_product.get(_normalize_sku(selection.sku)).category_name_2,
                        "category_name_3": sku_to_product.get(_normalize_sku(selection.sku)).category_name_3,
                        "sale_price": sku_to_product.get(_normalize_sku(selection.sku)).sale_price,
                    }
                    for selection in option.selections
                    if sku_to_product.get(_normalize_sku(selection.sku)) is not None
                ],
            }
            for option in bundles.options
        ],
    }


def _merge_reasoning_response(
    draft: BundleComposeResult,
    raw: dict[str, Any],
) -> BundleComposeResult:
    options_raw = raw.get("options")
    if not isinstance(options_raw, list):
        return draft

    merged_options: list[BundleOption] = []
    for index, draft_option in enumerate(draft.options):
        option_raw = options_raw[index] if index < len(options_raw) and isinstance(options_raw[index], dict) else {}
        title = _sanitize_user_facing_text(str(option_raw.get("title") or draft_option.title)) or draft_option.title
        summary = _sanitize_user_facing_text(str(option_raw.get("summary") or draft_option.summary)) or draft_option.summary
        explanation = _sanitize_user_facing_text(
            str(option_raw.get("explanation") or draft_option.explanation)
        ) or draft_option.explanation

        reasons_raw = option_raw.get("selection_reasons")
        merged_selections: list[BundleSelection] = []
        for selection_index, selection in enumerate(draft_option.selections):
            reason = selection.reason
            if isinstance(reasons_raw, list) and selection_index < len(reasons_raw):
                parsed_reason = _sanitize_user_facing_text(str(reasons_raw[selection_index] or ""))
                if parsed_reason:
                    reason = parsed_reason
            merged_selections.append(BundleSelection(sku=selection.sku, reason=reason))

        merged_options.append(
            BundleOption(
                title=title,
                summary=summary,
                explanation=explanation,
                selections=merged_selections,
            )
        )
    return BundleComposeResult(options=merged_options)


async def compose_bundle_with_ai(
    analysis: UserContentAnalysisResult,
    candidates: list[ProductRow],
    *,
    long_term_memory: dict[str, Any] | None = None,
) -> tuple[BundleComposeResult, list[str]]:
    logs: list[str] = []
    if not candidates:
        return BundleComposeResult(options=[]), ["[bundle_composer] no candidates"]

    t0 = time.perf_counter()
    ranked_candidates = _prepare_candidates(candidates)
    cache_key = _cache_key(analysis, ranked_candidates, long_term_memory)
    cached = _cache_get(cache_key)
    if cached is not None:
        logs.append("[bundle_composer] cache hit")
        return cached, logs

    logs.append(
        f"[bundle_composer] input candidates={len(candidates)}, used for compose={len(ranked_candidates)}"
    )
    if long_term_memory:
        used_keys = [k for k, v in long_term_memory.items() if v not in (None, "", [], {})]
        logs.append(f"[bundle_composer] long memory loaded: {used_keys}")

    sku_to_product = {
        _normalize_sku(c.sku_id_default): c
        for c in ranked_candidates
        if c.sku_id_default
    }
    heuristic = _build_heuristic_bundles(ranked_candidates, analysis)
    logs.append(
        f"[bundle_composer] heuristic bundles ready in {(time.perf_counter() - t0):.2f}s, "
        f"options={len(heuristic.options)}"
    )

    async def _generate_reasons() -> BundleComposeResult | None:
        try:
            llm = get_llm_client(
                model_settings.llm_bundle_provider,
                model=model_settings.llm_bundle_model,
            )
            logs.append(
                f"[bundle_composer] reasoning llm provider={model_settings.llm_bundle_provider}, "
                f"model={model_settings.llm_bundle_model}"
            )
            payload = _build_reasoning_payload(analysis, heuristic, sku_to_product)
            t_reason = time.perf_counter()
            result = await asyncio.wait_for(
                llm.chat(
                    messages=[
                        {"role": "system", "content": REASONING_SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": (
                                "Refine the bundle titles and reasons for the preselected options below.\n"
                                "Return JSON only.\n"
                                f"{json.dumps(payload, ensure_ascii=False)}"
                            ),
                        },
                    ],
                    temperature=0.2,
                    timeout_seconds=model_settings.llm_bundle_reasoning_timeout_seconds,
                ),
                timeout=model_settings.llm_bundle_reasoning_timeout_seconds,
            )
            logs.append(
                f"[bundle_composer] reasoning generated in {(time.perf_counter() - t_reason):.2f}s"
            )
            return _merge_reasoning_response(heuristic, _extract_json(result.content))
        except asyncio.TimeoutError:
            logs.append("[bundle_composer] reasoning timeout, using heuristic copy")
            return None
        except Exception as exc:
            logs.append(f"[bundle_composer] reasoning failed, using heuristic copy: {exc}")
            return None

    refined = await _generate_reasons()
    final_result = _sanitize_compose_result(refined or heuristic)
    logs.append(
        f"[bundle_composer] done in {(time.perf_counter() - t0):.2f}s, "
        f"options={len(final_result.options)}, total selections={sum(len(o.selections) for o in final_result.options)}"
    )
    _cache_set(cache_key, final_result)
    return final_result, logs
