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


def build_query_filters(analysis: UserContentAnalysisResult, limit: int = 20) -> QueryFilters:
    style_keywords: list[str] = []
    if analysis.style_preference:
        style_keywords.extend(_expand(analysis.style_preference, STYLE_SYNONYMS))

    room_keywords: list[str] = []
    if analysis.room_type:
        room_keywords.extend(_expand(analysis.room_type, ROOM_SYNONYMS))

    item_categories: list[str] = []
    for item in analysis.target_items:
        if item.category:
            item_categories.extend(_expand(item.category, ITEM_SYNONYMS))

    constraint_values: list[str] = list(analysis.hard_constraints)
    for item in analysis.target_items:
        constraint_values.extend(item.specific_features)
    constraint_keywords: list[str] = []
    for c in constraint_values:
        constraint_keywords.extend(_expand(c, CONSTRAINT_SYNONYMS))

    return QueryFilters(
        max_budget=analysis.total_budget,
        style_keywords=_clean(style_keywords),
        room_keywords=_clean(room_keywords),
        item_categories=_clean(item_categories),
        constraint_keywords=_clean(constraint_keywords),
        limit=limit,
    )
