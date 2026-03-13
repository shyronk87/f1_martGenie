from typing import Any

from sqlalchemy import text

from src.web.auth.db import async_session_maker

from .schema import ProductRow, QueryFilters


def _vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"


def _build_keyword_clauses(filters: QueryFilters) -> tuple[list[str], list[str], dict[str, Any]]:
    where_parts: list[str] = []
    score_parts: list[str] = []
    params: dict[str, Any] = {}

    if filters.max_budget is not None:
        where_parts.append("sale_price IS NOT NULL AND sale_price <= :max_budget")
        params["max_budget"] = filters.max_budget

    for i, kw in enumerate(filters.style_keywords):
        key = f"style_kw_{i}"
        params[key] = f"%{kw}%"
        score_parts.append(
            f"""(
                CASE WHEN (
                    COALESCE(specs->>'Style', '') ILIKE :{key}
                    OR COALESCE(title, '') ILIKE :{key}
                    OR COALESCE(search_text, '') ILIKE :{key}
                ) THEN 2 ELSE 0 END
            )"""
        )

    for i, kw in enumerate(filters.room_keywords):
        key = f"room_kw_{i}"
        params[key] = f"%{kw}%"
        score_parts.append(
            f"""(
                CASE WHEN (
                    COALESCE(category_name_1, '') ILIKE :{key}
                    OR COALESCE(category_name_2, '') ILIKE :{key}
                    OR COALESCE(category_name_3, '') ILIKE :{key}
                    OR COALESCE(category_name_4, '') ILIKE :{key}
                    OR COALESCE(title, '') ILIKE :{key}
                    OR COALESCE(search_text, '') ILIKE :{key}
                ) THEN 1 ELSE 0 END
            )"""
        )

    if filters.item_categories:
        item_sub_parts: list[str] = []
        for i, kw in enumerate(filters.item_categories):
            key = f"item_kw_{i}"
            params[key] = f"%{kw}%"
            item_sub_parts.append(
                f"""(
                    COALESCE(category_name_1, '') ILIKE :{key}
                    OR COALESCE(category_name_2, '') ILIKE :{key}
                    OR COALESCE(category_name_3, '') ILIKE :{key}
                    OR COALESCE(category_name_4, '') ILIKE :{key}
                    OR COALESCE(title, '') ILIKE :{key}
                    OR COALESCE(search_text, '') ILIKE :{key}
                )"""
            )
        where_parts.append("(" + " OR ".join(item_sub_parts) + ")")

    for i, kw in enumerate(filters.constraint_keywords):
        key = f"constraint_kw_{i}"
        params[key] = f"%{kw}%"
        score_parts.append(
            f"""(
                CASE WHEN (
                    COALESCE(description_text, '') ILIKE :{key}
                    OR COALESCE(title, '') ILIKE :{key}
                    OR COALESCE(specs::text, '') ILIKE :{key}
                    OR COALESCE(search_text, '') ILIKE :{key}
                ) THEN 1 ELSE 0 END
            )"""
        )

    return where_parts, score_parts, params


def _build_query(filters: QueryFilters) -> tuple[str, dict[str, Any]]:
    where_parts, score_parts, params = _build_keyword_clauses(filters)
    keyword_score_sql = "0"
    if score_parts:
        keyword_score_sql = " + ".join(score_parts)

    params["final_limit"] = filters.final_limit
    params["semantic_weight"] = filters.semantic_weight
    params["keyword_weight"] = filters.keyword_weight

    where_sql = ""
    if where_parts:
        where_sql = "WHERE " + " AND ".join(where_parts)

    if filters.query_vector:
        params["query_vector"] = _vector_literal(filters.query_vector)
        params["vector_top_k"] = filters.vector_top_k
        sql = f"""
            WITH vector_candidates AS (
                SELECT
                    sku_id_default,
                    spu_id,
                    title,
                    description_text,
                    category_name_1,
                    category_name_2,
                    category_name_3,
                    category_name_4,
                    sale_price,
                    original_price,
                    stock_status_text,
                    main_image_url,
                    product_url,
                    specs,
                    review_count,
                    search_text,
                    (1 - (embedding <=> CAST(:query_vector AS vector))) AS semantic_score
                FROM homary_products
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:query_vector AS vector)
                LIMIT :vector_top_k
            )
            SELECT
                sku_id_default,
                spu_id,
                title,
                description_text,
                category_name_1,
                category_name_2,
                category_name_3,
                category_name_4,
                sale_price,
                original_price,
                stock_status_text,
                main_image_url,
                product_url,
                specs,
                semantic_score,
                ({keyword_score_sql}) AS keyword_score,
                (
                    (:semantic_weight * COALESCE(semantic_score, 0))
                    + (:keyword_weight * ({keyword_score_sql}))
                ) AS final_score
            FROM vector_candidates
            {where_sql}
            ORDER BY
                final_score DESC,
                CASE WHEN stock_status_text = 'In stock' THEN 0 ELSE 1 END ASC,
                sale_price ASC NULLS LAST,
                review_count DESC NULLS LAST
            LIMIT :final_limit
        """
        return sql, params

    # Fallback: keyword-only query.
    sql = f"""
        SELECT
            sku_id_default,
            spu_id,
            title,
            description_text,
            category_name_1,
            category_name_2,
            category_name_3,
            category_name_4,
            sale_price,
            original_price,
            stock_status_text,
            main_image_url,
            product_url,
            specs,
            NULL::double precision AS semantic_score,
            ({keyword_score_sql}) AS keyword_score,
            ({keyword_score_sql})::double precision AS final_score
        FROM homary_products
        {where_sql}
        ORDER BY
            final_score DESC,
            CASE WHEN stock_status_text = 'In stock' THEN 0 ELSE 1 END ASC,
            sale_price ASC NULLS LAST,
            review_count DESC NULLS LAST
        LIMIT :final_limit
    """
    return sql, params


async def query_products(filters: QueryFilters) -> list[ProductRow]:
    sql, params = _build_query(filters)
    stmt = text(sql)
    async with async_session_maker() as session:
        rows = (await session.execute(stmt, params)).mappings().all()
    return [ProductRow(**dict(row)) for row in rows]
