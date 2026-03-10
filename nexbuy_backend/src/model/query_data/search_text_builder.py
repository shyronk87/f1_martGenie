import json
import re
from typing import Any


_SPACE_RE = re.compile(r"\s+")
_SPEC_KEY_BLACKLIST = {"sku", "spu", "id"}

_STYLE_TAGS = {
    "industrial": ["industrial", "metal frame", "black metal", "iron"],
    "minimalist": ["minimalist", "minimal", "clean lines"],
    "modern": ["modern", "contemporary"],
    "wood": ["wood", "wooden", "oak", "walnut", "ash"],
    "japandi": ["japandi", "scandinavian", "wabi-sabi"],
}

_ROOM_TAGS = {
    "living room": ["living room", "lounge"],
    "bedroom": ["bedroom"],
    "dining room": ["dining room", "dining area"],
    "study room": ["study room", "home office", "office"],
}

_PET_TAGS = {
    "pet-friendly": ["pet", "cat", "dog", "scratch-resistant", "durable fabric"],
}

_MATERIAL_TAGS = {
    "wood": ["wood", "oak", "walnut", "ash", "teak"],
    "metal": ["metal", "steel", "iron", "aluminum"],
    "fabric": ["fabric", "linen", "boucle", "velvet"],
    "leather": ["leather", "faux leather", "pu leather"],
    "stone": ["stone", "marble", "sintered stone"],
    "glass": ["glass", "tempered glass"],
}


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    return _SPACE_RE.sub(" ", text)


def _flatten_specs(specs: Any, max_items: int = 40) -> str:
    if specs is None:
        return ""

    if isinstance(specs, str):
        stripped = specs.strip()
        if not stripped:
            return ""
        try:
            parsed = json.loads(stripped)
            specs = parsed
        except json.JSONDecodeError:
            return _clean_text(specs)

    if isinstance(specs, dict):
        parts: list[str] = []
        for key, value in specs.items():
            key_text = _clean_text(key)
            if not key_text:
                continue
            if key_text.lower() in _SPEC_KEY_BLACKLIST:
                continue
            value_text = _clean_text(value)
            if not value_text:
                continue
            parts.append(f"{key_text}: {value_text}")
            if len(parts) >= max_items:
                break
        return "; ".join(parts)

    if isinstance(specs, list):
        parts = [_clean_text(v) for v in specs if _clean_text(v)]
        return "; ".join(parts[:max_items])

    return _clean_text(specs)


def _extract_tags(text_blob: str) -> list[str]:
    text = text_blob.lower()
    tags: list[str] = []
    seen: set[str] = set()

    def add_tag(tag: str) -> None:
        if tag not in seen:
            seen.add(tag)
            tags.append(tag)

    for tag, patterns in _STYLE_TAGS.items():
        if any(p in text for p in patterns):
            add_tag(f"style:{tag}")

    for tag, patterns in _ROOM_TAGS.items():
        if any(p in text for p in patterns):
            add_tag(f"room:{tag}")

    for tag, patterns in _PET_TAGS.items():
        if any(p in text for p in patterns):
            add_tag(tag)

    for tag, patterns in _MATERIAL_TAGS.items():
        if any(p in text for p in patterns):
            add_tag(f"material:{tag}")

    return tags


def build_search_text(row: dict[str, Any], max_chars: int = 4000) -> str:
    title = _clean_text(row.get("title"))
    categories = " | ".join(
        [
            _clean_text(row.get("category_name_1")),
            _clean_text(row.get("category_name_2")),
            _clean_text(row.get("category_name_3")),
            _clean_text(row.get("category_name_4")),
        ]
    ).strip(" |")
    description = _clean_text(row.get("description_text"))
    specs_text = _flatten_specs(row.get("specs"))

    seed = " ".join([title, categories, description, specs_text]).strip()
    tags = " | ".join(_extract_tags(seed))

    merged = "\n".join(
        [
            f"title: {title}",
            f"category: {categories}",
            f"description: {description}",
            f"specs: {specs_text}",
            f"tags: {tags}",
        ]
    ).strip()
    if len(merged) <= max_chars:
        return merged
    return merged[:max_chars]

