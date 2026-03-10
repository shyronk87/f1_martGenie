import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from src.model.query_data.search_text_builder import build_search_text
from src.model.config import model_settings
from src.web.auth.config import settings


ROOT_DIR = BACKEND_ROOT
DEFAULT_INPUT = ROOT_DIR / "result" / "homary_spu.jsonl"
DEFAULT_TABLE = "homary_products"
EMBEDDING_DIM = int(model_settings.glm_embedding_dim or 2048)

HTML_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")
TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
PERCENT_RE = re.compile(r"(-?\d+(?:\.\d+)?)%")


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS homary_products (
    sku_id_default TEXT PRIMARY KEY,
    spu_id TEXT,
    spu_code TEXT,
    title TEXT NOT NULL,
    sub_title TEXT,
    sku_code_default TEXT,
    category_name_1 TEXT,
    category_name_2 TEXT,
    category_name_3 TEXT,
    category_name_4 TEXT,
    category_id_1 TEXT,
    category_id_2 TEXT,
    category_id_3 TEXT,
    category_id_4 TEXT,
    rating_value NUMERIC(4, 2),
    review_count INTEGER,
    main_image_url TEXT,
    gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    gallery_image_count INTEGER NOT NULL DEFAULT 0,
    gallery_video_count INTEGER NOT NULL DEFAULT 0,
    description_text TEXT,
    specs JSONB NOT NULL DEFAULT '{}'::jsonb,
    search_text TEXT,
    embedding vector(1024),
    currency_symbol TEXT,
    sale_price NUMERIC(10, 2),
    original_price NUMERIC(10, 2),
    tag_price NUMERIC(10, 2),
    compare_price NUMERIC(10, 2),
    final_price NUMERIC(10, 2),
    price_kp_cents INTEGER,
    discount_text TEXT,
    discount_percent NUMERIC(5, 2),
    stock_status_code INTEGER,
    stock_status_text TEXT,
    sale_region_status INTEGER,
    is_pre_sale INTEGER,
    activity_stock INTEGER,
    activity_id TEXT,
    activity_type INTEGER,
    activity_price NUMERIC(10, 2),
    activity_start_ts BIGINT,
    activity_end_ts BIGINT,
    activity_tip_text TEXT,
    product_url TEXT,
    canonical_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

CREATE_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS vector;"

ALTER_VECTOR_COLUMNS_SQL = """
ALTER TABLE homary_products
ADD COLUMN IF NOT EXISTS search_text TEXT,
ADD COLUMN IF NOT EXISTS embedding vector(1024);
"""


UPSERT_SQL = """
INSERT INTO homary_products (
    sku_id_default, spu_id, spu_code, title, sub_title, sku_code_default,
    category_name_1, category_name_2, category_name_3, category_name_4,
    category_id_1, category_id_2, category_id_3, category_id_4,
    rating_value, review_count, main_image_url,
    gallery_image_urls, gallery_image_count, gallery_video_count,
    description_text, specs, search_text,
    currency_symbol, sale_price, original_price, tag_price, compare_price, final_price, price_kp_cents,
    discount_text, discount_percent,
    stock_status_code, stock_status_text, sale_region_status, is_pre_sale, activity_stock,
    activity_id, activity_type, activity_price, activity_start_ts, activity_end_ts, activity_tip_text,
    product_url, canonical_url, updated_at
) VALUES (
    :sku_id_default, :spu_id, :spu_code, :title, :sub_title, :sku_code_default,
    :category_name_1, :category_name_2, :category_name_3, :category_name_4,
    :category_id_1, :category_id_2, :category_id_3, :category_id_4,
    :rating_value, :review_count, :main_image_url,
    CAST(:gallery_image_urls AS JSONB), :gallery_image_count, :gallery_video_count,
    :description_text, CAST(:specs AS JSONB), :search_text,
    :currency_symbol, :sale_price, :original_price, :tag_price, :compare_price, :final_price, :price_kp_cents,
    :discount_text, :discount_percent,
    :stock_status_code, :stock_status_text, :sale_region_status, :is_pre_sale, :activity_stock,
    :activity_id, :activity_type, :activity_price, :activity_start_ts, :activity_end_ts, :activity_tip_text,
    :product_url, :canonical_url, NOW()
)
ON CONFLICT (sku_id_default) DO UPDATE SET
    spu_id = EXCLUDED.spu_id,
    spu_code = EXCLUDED.spu_code,
    title = EXCLUDED.title,
    sub_title = EXCLUDED.sub_title,
    sku_code_default = EXCLUDED.sku_code_default,
    category_name_1 = EXCLUDED.category_name_1,
    category_name_2 = EXCLUDED.category_name_2,
    category_name_3 = EXCLUDED.category_name_3,
    category_name_4 = EXCLUDED.category_name_4,
    category_id_1 = EXCLUDED.category_id_1,
    category_id_2 = EXCLUDED.category_id_2,
    category_id_3 = EXCLUDED.category_id_3,
    category_id_4 = EXCLUDED.category_id_4,
    rating_value = EXCLUDED.rating_value,
    review_count = EXCLUDED.review_count,
    main_image_url = EXCLUDED.main_image_url,
    gallery_image_urls = EXCLUDED.gallery_image_urls,
    gallery_image_count = EXCLUDED.gallery_image_count,
    gallery_video_count = EXCLUDED.gallery_video_count,
    description_text = EXCLUDED.description_text,
    specs = EXCLUDED.specs,
    search_text = EXCLUDED.search_text,
    currency_symbol = EXCLUDED.currency_symbol,
    sale_price = EXCLUDED.sale_price,
    original_price = EXCLUDED.original_price,
    tag_price = EXCLUDED.tag_price,
    compare_price = EXCLUDED.compare_price,
    final_price = EXCLUDED.final_price,
    price_kp_cents = EXCLUDED.price_kp_cents,
    discount_text = EXCLUDED.discount_text,
    discount_percent = EXCLUDED.discount_percent,
    stock_status_code = EXCLUDED.stock_status_code,
    stock_status_text = EXCLUDED.stock_status_text,
    sale_region_status = EXCLUDED.sale_region_status,
    is_pre_sale = EXCLUDED.is_pre_sale,
    activity_stock = EXCLUDED.activity_stock,
    activity_id = EXCLUDED.activity_id,
    activity_type = EXCLUDED.activity_type,
    activity_price = EXCLUDED.activity_price,
    activity_start_ts = EXCLUDED.activity_start_ts,
    activity_end_ts = EXCLUDED.activity_end_ts,
    activity_tip_text = EXCLUDED.activity_tip_text,
    product_url = EXCLUDED.product_url,
    canonical_url = EXCLUDED.canonical_url,
    updated_at = NOW();
"""


def to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def clean_html_text(value: Any) -> str | None:
    if not value or not isinstance(value, str):
        return None
    text_no_tags = HTML_TAG_RE.sub(" ", value)
    text_norm = WHITESPACE_RE.sub(" ", text_no_tags).strip()
    return text_norm or None


def parse_percent(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    text_value = value.strip()
    if not text_value:
        return None
    m = PERCENT_RE.search(text_value)
    if m:
        return to_float(m.group(1))
    return to_float(text_value)


def extract_currency_symbol(*candidates: Any) -> str | None:
    for raw in candidates:
        if not isinstance(raw, str):
            continue
        s = raw.strip()
        if not s:
            continue
        for ch in s:
            if ch.isdigit() or ch in ".,-+ ":
                continue
            if ch in "<>/=\"'":
                continue
            if ch.isalpha():
                continue
            return ch
    return None


def simplify_specs(details: Any, limit: int = 30) -> dict[str, str]:
    if not isinstance(details, list):
        return {}

    out: dict[str, str] = {}
    for item in details:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        value = item.get("value")
        if not key or value in (None, ""):
            continue
        if key in out:
            continue
        out[str(key)] = str(value)
        if len(out) >= limit:
            break
    return out


def simplify_gallery(product_img: Any, keep_limit: int = 12) -> tuple[list[str], int, int]:
    if not isinstance(product_img, list):
        return [], 0, 0

    image_urls: list[str] = []
    image_count = 0
    video_count = 0

    for item in product_img:
        if not isinstance(item, dict):
            continue
        url = item.get("img_url")
        media_type = item.get("type")

        if media_type == 2:
            video_count += 1
            continue

        image_count += 1
        if isinstance(url, str) and url and len(image_urls) < keep_limit:
            image_urls.append(url)

    return image_urls, image_count, video_count


def transform_record(raw: dict[str, Any]) -> dict[str, Any]:
    categories = raw.get("categories")
    if not isinstance(categories, dict):
        categories = {}

    image_urls, image_count, video_count = simplify_gallery(raw.get("product_img"))
    price_info = raw.get("price_info_default")
    if not isinstance(price_info, dict):
        price_info = {}
    status_info = raw.get("status_info_default")
    if not isinstance(status_info, dict):
        status_info = {}
    act_info = raw.get("act_info_default")
    if not isinstance(act_info, dict):
        act_info = {}

    simplified_specs = simplify_specs(raw.get("details"))
    row = {
        "spu_id": str(raw.get("spu_id") or "").strip() or None,
        "spu_code": raw.get("spu_code"),
        "title": raw.get("title") or "",
        "sub_title": raw.get("sub_title"),
        "sku_id_default": str(raw.get("sku_id_default") or "").strip() or None,
        "sku_code_default": raw.get("sku_code_default"),
        "category_name_1": categories.get("name1"),
        "category_name_2": categories.get("name2"),
        "category_name_3": categories.get("name3"),
        "category_name_4": categories.get("name4"),
        "category_id_1": str(categories.get("id1")) if categories.get("id1") is not None else None,
        "category_id_2": str(categories.get("id2")) if categories.get("id2") is not None else None,
        "category_id_3": str(categories.get("id3")) if categories.get("id3") is not None else None,
        "category_id_4": str(categories.get("id4")) if categories.get("id4") is not None else None,
        "rating_value": to_float(raw.get("ratingValue")),
        "review_count": to_int(raw.get("reviewCount")),
        "main_image_url": raw.get("product_main_img"),
        "gallery_image_urls": json.dumps(image_urls, ensure_ascii=False),
        "gallery_image_count": image_count,
        "gallery_video_count": video_count,
        "description_text": clean_html_text(raw.get("description")),
        "specs": json.dumps(simplified_specs, ensure_ascii=False),
        "currency_symbol": extract_currency_symbol(
            price_info.get("ps"),
            price_info.get("nps"),
            price_info.get("tps"),
            price_info.get("cps"),
            price_info.get("ap"),
        ),
        "sale_price": to_float(price_info.get("p")),
        "original_price": to_float(price_info.get("np")),
        "tag_price": to_float(price_info.get("tp")),
        "compare_price": to_float(price_info.get("cp")),
        "final_price": to_float(price_info.get("fp")),
        "price_kp_cents": to_int(price_info.get("kp")),
        "discount_text": price_info.get("po"),
        "discount_percent": parse_percent(price_info.get("po")),
        "stock_status_code": to_int(status_info.get("s")),
        "stock_status_text": status_info.get("sd"),
        "sale_region_status": to_int(status_info.get("sale_region_status")),
        "is_pre_sale": to_int(status_info.get("is_pre")),
        "activity_stock": to_int(act_info.get("stock")),
        "activity_id": str(act_info.get("id")) if act_info.get("id") is not None else None,
        "activity_type": to_int(act_info.get("t")),
        "activity_price": to_float(act_info.get("p")),
        "activity_start_ts": to_int(act_info.get("sts")),
        "activity_end_ts": to_int(act_info.get("ets")),
        "activity_tip_text": act_info.get("ct"),
        "product_url": raw.get("url"),
        "canonical_url": raw.get("canonical"),
    }
    row["search_text"] = build_search_text(
        {
            "title": row.get("title"),
            "category_name_1": row.get("category_name_1"),
            "category_name_2": row.get("category_name_2"),
            "category_name_3": row.get("category_name_3"),
            "category_name_4": row.get("category_name_4"),
            "description_text": row.get("description_text"),
            "specs": simplified_specs,
        }
    )
    return row


async def import_products(
    input_path: Path,
    table_name: str,
    batch_size: int = 300,
    limit: int | None = None,
) -> None:
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    if not TABLE_NAME_RE.fullmatch(table_name):
        raise ValueError(f"Invalid table name: {table_name}")

    create_sql = text(
        CREATE_TABLE_SQL.replace("homary_products", table_name).replace(
            "vector(1024)", f"vector({EMBEDDING_DIM})"
        )
    )
    create_extension_sql = text(CREATE_EXTENSION_SQL)
    alter_vector_sql = text(
        ALTER_VECTOR_COLUMNS_SQL.replace("homary_products", table_name).replace(
            "vector(1024)", f"vector({EMBEDDING_DIM})"
        )
    )
    upsert_sql = text(UPSERT_SQL.replace("homary_products", table_name))

    engine = create_async_engine(settings.database_url, echo=False)
    try:
        total_lines = 0
        imported = 0
        bad_json = 0
        invalid_rows = 0
        buffer: list[dict[str, Any]] = []

        async with engine.begin() as conn:
            await conn.execute(create_extension_sql)
            await conn.execute(create_sql)
            await conn.execute(alter_vector_sql)

            with input_path.open("r", encoding="utf-8") as f:
                for line_no, line in enumerate(f, start=1):
                    if limit is not None and imported >= limit:
                        break

                    raw_line = line.strip()
                    if not raw_line:
                        continue

                    total_lines += 1
                    try:
                        raw = json.loads(raw_line)
                    except json.JSONDecodeError:
                        bad_json += 1
                        print(f"[WARN] Skip bad JSON at line {line_no}")
                        continue

                    row = transform_record(raw)
                    if not row["sku_id_default"] or not row["title"]:
                        invalid_rows += 1
                        print(f"[WARN] Skip invalid row at line {line_no}: missing sku_id_default/title")
                        continue

                    buffer.append(row)
                    flush_size = batch_size
                    if limit is not None:
                        flush_size = min(batch_size, max(limit - imported, 1))

                    if len(buffer) >= flush_size:
                        await conn.execute(upsert_sql, buffer)
                        imported += len(buffer)
                        print(f"[INFO] Imported {imported} rows")
                        buffer.clear()

                if buffer:
                    await conn.execute(upsert_sql, buffer)
                    imported += len(buffer)

        print("===== Import Finished =====")
        print(f"Input file      : {input_path}")
        print(f"Target table    : {table_name}")
        print(f"Total lines     : {total_lines}")
        print(f"Imported rows   : {imported}")
        print(f"Bad JSON rows   : {bad_json}")
        print(f"Invalid rows    : {invalid_rows}")
    finally:
        await engine.dispose()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import Homary SPU data into PostgreSQL.")
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to input JSONL file (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--table",
        type=str,
        default=DEFAULT_TABLE,
        help=f"Target table name (default: {DEFAULT_TABLE})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=300,
        help="Rows per batch write (default: 300)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum rows to import (default: 0 means no limit)",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    limit = args.limit if args.limit and args.limit > 0 else None
    await import_products(args.input, args.table, args.batch_size, limit)


if __name__ == "__main__":
    asyncio.run(main())
