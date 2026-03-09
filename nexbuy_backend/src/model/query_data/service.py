from src.model.user_content_analysis.schema import UserContentAnalysisResult

from .db import query_products
from .mapper import build_query_filters
from .schema import QueryDataResult


async def query_products_from_analysis(
    analysis: UserContentAnalysisResult,
    *,
    limit: int = 20,
) -> QueryDataResult:
    if not analysis.is_ready:
        return QueryDataResult(
            is_ready=False,
            missing_fields=analysis.missing_fields,
            agent_reply=analysis.agent_reply,
            filters=None,
            products=[],
        )

    filters = build_query_filters(analysis, limit=limit)
    products = await query_products(filters)
    return QueryDataResult(
        is_ready=True,
        missing_fields=[],
        agent_reply=analysis.agent_reply,
        filters=filters,
        products=products,
    )
