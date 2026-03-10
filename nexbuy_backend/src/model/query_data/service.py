import time
from typing import Any

from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .db import query_products
from .mapper import build_query_filters
from .schema import QueryDataResult


async def query_products_from_analysis(
    analysis: UserContentAnalysisResult,
    *,
    limit: int = 20,
    long_term_memory: dict[str, Any] | None = None,
) -> QueryDataResult:
    logs: list[str] = []
    t0 = time.perf_counter()
    logs.append("[query_data] start")

    if not analysis.is_ready:
        logs.append(f"[query_data] skip query, missing fields: {analysis.missing_fields}")
        logs.append(f"[query_data] done in {(time.perf_counter() - t0):.2f}s")
        return QueryDataResult(
            is_ready=False,
            missing_fields=analysis.missing_fields,
            agent_reply=analysis.agent_reply,
            filters=None,
            products=[],
            debug_logs=logs,
        )

    t_map = time.perf_counter()
    filters, memory_used_fields = build_query_filters(
        analysis,
        limit=limit,
        long_term_memory=long_term_memory,
    )
    logs.append(f"[query_data] filters built in {(time.perf_counter() - t_map):.2f}s")
    if memory_used_fields:
        logs.append(f"[query_data] used long memory fields: {memory_used_fields}")
    elif long_term_memory:
        logs.append("[query_data] long memory loaded, no fallback field applied")
    logs.append(
        "[query_data] filters summary: "
        f"budget={filters.max_budget}, style={len(filters.style_keywords)}, "
        f"room={len(filters.room_keywords)}, items={len(filters.item_categories)}, "
        f"constraints={len(filters.constraint_keywords)}"
    )

    t_db = time.perf_counter()
    products = await query_products(filters)
    logs.append(f"[query_data] db query finished in {(time.perf_counter() - t_db):.2f}s")
    logs.append(f"[query_data] matched products={len(products)}")
    logs.append(f"[query_data] done in {(time.perf_counter() - t0):.2f}s")
    return QueryDataResult(
        is_ready=True,
        missing_fields=[],
        agent_reply=analysis.agent_reply,
        filters=filters,
        products=products,
        debug_logs=logs,
    )
