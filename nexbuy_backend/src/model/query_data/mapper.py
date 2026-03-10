from typing import Any

from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .schema import QueryFilters


STYLE_SYNONYMS = {
    "wood-style": ["wood", "wooden", "walnut", "oak", "natural"],
    "wood style": ["wood", "wooden", "walnut", "oak", "natural"],
    "minimalist": ["minimalist", "minimal", "modern", "clean lines"],
}

ROOM_SYNONYMS = {
    "living room": ["living room", "lounge"],
    "bedroom": ["bedroom"],
    "dining room": ["dining room", "dining"],
}

ITEM_SYNONYMS = {
    "sofa": ["sofa", "sectional", "couch", "loveseat"],
    "coffee table": ["coffee table", "center table"],
    "rug": ["rug", "carpet"],
}

CONSTRAINT_SYNONYMS = {
    "pet-friendly": ["pet", "cat", "dog", "scratch", "durable"],
    "scratch-resistant": ["scratch", "resistant", "durable", "performance fabric"],
}


def _clean(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        v = value.strip()
        if v and v not in out:
            out.append(v)
    return out


def _expand(value: str, mapping: dict[str, list[str]]) -> list[str]:
    v = value.strip().lower()
    if not v:
        return []
    expanded = [v]
    expanded.extend(mapping.get(v, []))
    for token in v.replace("-", " ").split():
        if len(token) >= 3 and token not in {"the", "and", "for", "with"}:
            expanded.append(token)
    return _clean(expanded)


def build_query_filters(
    analysis: UserContentAnalysisResult,
    *,
    limit: int = 20,
    long_term_memory: dict[str, Any] | None = None,
) -> tuple[QueryFilters, list[str]]:
    memory_used_fields: list[str] = []
    style_keywords: list[str] = []
    if analysis.style_preference:
        style_keywords.extend(_expand(analysis.style_preference, STYLE_SYNONYMS))
    elif long_term_memory:
        memory_styles = [
            str(v).strip()
            for v in (long_term_memory.get("style_preferences") or [])
            if str(v).strip()
        ]
        if memory_styles:
            style_keywords.extend(_expand(memory_styles[0], STYLE_SYNONYMS))
            memory_used_fields.append("style_preferences")

    room_keywords: list[str] = []
    if analysis.room_type:
        room_keywords.extend(_expand(analysis.room_type, ROOM_SYNONYMS))
    elif long_term_memory:
        memory_rooms = [
            str(v).strip()
            for v in (long_term_memory.get("room_priorities") or [])
            if str(v).strip()
        ]
        if memory_rooms:
            room_keywords.extend(_expand(memory_rooms[0], ROOM_SYNONYMS))
            memory_used_fields.append("room_priorities")

    item_categories: list[str] = []
    for item in analysis.target_items:
        if item.category:
            item_categories.extend(_expand(item.category, ITEM_SYNONYMS))

    constraint_values: list[str] = list(analysis.hard_constraints)
    for item in analysis.target_items:
        constraint_values.extend(item.specific_features)
    if not constraint_values and long_term_memory:
        memory_constraints = [
            str(v).strip()
            for v in (long_term_memory.get("negative_constraints") or [])
            if str(v).strip()
        ]
        household = {
            str(v).strip().lower()
            for v in (long_term_memory.get("household_members") or [])
            if str(v).strip()
        }
        if "cat" in household:
            memory_constraints.append("pet-friendly for cats")
        if "dog" in household:
            memory_constraints.append("pet-friendly for dogs")
        if memory_constraints:
            constraint_values.extend(memory_constraints)
            memory_used_fields.append("negative_constraints/household_members")

    constraint_keywords: list[str] = []
    for c in constraint_values:
        constraint_keywords.extend(_expand(c, CONSTRAINT_SYNONYMS))

    return (
        QueryFilters(
            max_budget=analysis.total_budget,
            style_keywords=_clean(style_keywords),
            room_keywords=_clean(room_keywords),
            item_categories=_clean(item_categories),
            constraint_keywords=_clean(constraint_keywords),
            limit=limit,
        ),
        memory_used_fields,
    )
