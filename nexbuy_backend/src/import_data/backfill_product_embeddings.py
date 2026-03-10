import argparse
import asyncio
from pathlib import Path
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_ROOT = Path(__file__).resolve().parents[2]
import sys

if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from src.model.query_data.embedding_service import EmbeddingService, vector_to_literal
from src.model.query_data.search_text_builder import build_search_text
from src.model.config import model_settings
from src.web.auth.config import settings


DEFAULT_TABLE = "homary_products"
DEFAULT_BATCH_SIZE = 32
DEFAULT_LIMIT = 0
EMBEDDING_DIM = int(model_settings.glm_embedding_dim or 2048)
TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

CREATE_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS vector;"
ALTER_VECTOR_COLUMNS_SQL = """
ALTER TABLE homary_products
ADD COLUMN IF NOT EXISTS search_text TEXT,
ADD COLUMN IF NOT EXISTS embedding vector(1024);
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill product search_text and embedding vectors.")
    parser.add_argument("--table", type=str, default=DEFAULT_TABLE, help="Target table name.")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Rows per embedding request batch.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help="Maximum rows to process. 0 means no limit.",
    )
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only process rows with missing embedding.",
    )
    parser.add_argument(
        "--rebuild-search-text",
        action="store_true",
        help="Always rebuild and overwrite search_text.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build texts and vectors but do not update database.",
    )
    return parser.parse_args()


def _select_sql(table_name: str, only_missing: bool) -> str:
    where_parts: list[str] = ["sku_id_default > :cursor_sku"]
    if only_missing:
        where_parts.append("embedding IS NULL")
    where_clause = "WHERE " + " AND ".join(where_parts)
    return f"""
        SELECT
            sku_id_default,
            title,
            category_name_1,
            category_name_2,
            category_name_3,
            category_name_4,
            description_text,
            specs,
            search_text,
            embedding
        FROM {table_name}
        {where_clause}
        ORDER BY sku_id_default ASC
        LIMIT :limit
    """


def _build_update_stmt(table_name: str) -> str:
    return f"""
        UPDATE {table_name}
        SET
            search_text = :search_text,
            embedding = CAST(:embedding AS vector),
            updated_at = NOW()
        WHERE sku_id_default = :sku_id_default
    """


async def backfill_embeddings(
    table_name: str,
    batch_size: int,
    limit: int | None,
    only_missing: bool,
    rebuild_search_text: bool,
    dry_run: bool,
) -> None:
    if not TABLE_NAME_RE.fullmatch(table_name):
        raise ValueError(f"Invalid table name: {table_name}")

    engine = create_async_engine(settings.database_url, echo=False)
    embedding_service = EmbeddingService()
    try:
        create_extension_sql = text(CREATE_EXTENSION_SQL)
        alter_vector_sql = text(
            ALTER_VECTOR_COLUMNS_SQL.replace("homary_products", table_name).replace(
                "vector(1024)", f"vector({EMBEDDING_DIM})"
            )
        )
        select_stmt = text(_select_sql(table_name, only_missing))
        update_stmt = text(_build_update_stmt(table_name))

        processed = 0
        updated = 0
        cursor_sku = ""

        async with engine.begin() as conn:
            await conn.execute(create_extension_sql)
            await conn.execute(alter_vector_sql)

            while True:
                fetch_limit = batch_size
                if limit is not None:
                    remain = limit - processed
                    if remain <= 0:
                        break
                    fetch_limit = min(fetch_limit, remain)

                rows = (
                    await conn.execute(
                        select_stmt,
                        {"limit": fetch_limit, "cursor_sku": cursor_sku},
                    )
                ).mappings().all()
                if not rows:
                    break

                processed += len(rows)
                cursor_sku = str(rows[-1]["sku_id_default"])

                texts: list[str] = []
                update_payload: list[dict[str, Any]] = []

                for row in rows:
                    data = dict(row)
                    current_text = str(data.get("search_text") or "").strip()
                    if rebuild_search_text or not current_text:
                        current_text = build_search_text(data)

                    texts.append(current_text)
                    update_payload.append(
                        {
                            "sku_id_default": str(data["sku_id_default"]),
                            "search_text": current_text,
                        }
                    )

                vectors = await embedding_service.embed_texts(texts)
                for i, vector in enumerate(vectors):
                    update_payload[i]["embedding"] = vector_to_literal(vector)

                if dry_run:
                    print(
                        f"[DRY-RUN] prepared batch rows={len(update_payload)} "
                        f"(processed={processed})"
                    )
                    continue

                await conn.execute(update_stmt, update_payload)
                updated += len(update_payload)
                print(f"[INFO] updated={updated}, processed={processed}")

        print("===== Embedding Backfill Finished =====")
        print(f"Target table   : {table_name}")
        print(f"Processed rows : {processed}")
        print(f"Updated rows   : {updated}")
        print(f"Dry run        : {dry_run}")
    finally:
        await engine.dispose()


async def main() -> None:
    args = parse_args()
    limit = args.limit if args.limit and args.limit > 0 else None
    await backfill_embeddings(
        table_name=args.table,
        batch_size=max(1, args.batch_size),
        limit=limit,
        only_missing=args.only_missing,
        rebuild_search_text=args.rebuild_search_text,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    asyncio.run(main())
