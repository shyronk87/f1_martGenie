import argparse
import asyncio
import statistics
import time
from dataclasses import dataclass

from src.model.bundle_composer import compose_bundle_with_ai
from src.model.query_data import query_products_from_analysis
from src.model.user_content_analysis import analyze_user_content


DEFAULT_QUERIES = [
    "I need a grey modular sofa for my living room under $1200.",
    "Find a warm bedside lamp and a small side table for my bedroom under $300.",
    "Recommend a mid-century coffee table for a compact living room under $450.",
]


@dataclass
class PerfRow:
    query: str
    analysis_ms: float
    query_ms: float
    compose_ms: float
    total_ms: float
    product_count: int
    option_count: int


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1)))))
    return ordered[rank]


async def _run_once(user_text: str, limit: int) -> PerfRow:
    t0 = time.perf_counter()
    analysis = await analyze_user_content([{"role": "user", "content": user_text}])
    t1 = time.perf_counter()
    query_result = await query_products_from_analysis(analysis, limit=limit)
    t2 = time.perf_counter()
    bundle_result, _ = await compose_bundle_with_ai(analysis, query_result.products)
    t3 = time.perf_counter()
    return PerfRow(
        query=user_text,
        analysis_ms=(t1 - t0) * 1000.0,
        query_ms=(t2 - t1) * 1000.0,
        compose_ms=(t3 - t2) * 1000.0,
        total_ms=(t3 - t0) * 1000.0,
        product_count=len(query_result.products),
        option_count=len(bundle_result.options),
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="Latency benchmark for full recommendation flow.")
    parser.add_argument("--rounds", type=int, default=1, help="How many times to run each query.")
    parser.add_argument("--limit", type=int, default=20, help="Matched products limit.")
    args = parser.parse_args()

    rows: list[PerfRow] = []
    for round_index in range(max(1, args.rounds)):
        print(f"round {round_index + 1}/{max(1, args.rounds)}")
        for query in DEFAULT_QUERIES:
            row = await _run_once(query, max(1, args.limit))
            rows.append(row)
            print(
                f"- total={row.total_ms:.1f}ms | analysis={row.analysis_ms:.1f}ms "
                f"| query={row.query_ms:.1f}ms | compose={row.compose_ms:.1f}ms "
                f"| products={row.product_count} | options={row.option_count}"
            )

    totals = [row.total_ms for row in rows]
    analyses = [row.analysis_ms for row in rows]
    queries = [row.query_ms for row in rows]
    composes = [row.compose_ms for row in rows]

    print("\n=== Summary ===")
    print(f"sample_size: {len(rows)}")
    print(
        "total_ms: "
        f"avg={statistics.mean(totals):.1f}, p50={_percentile(totals, 50):.1f}, "
        f"p95={_percentile(totals, 95):.1f}, max={max(totals):.1f}"
    )
    print(
        "analysis_ms: "
        f"avg={statistics.mean(analyses):.1f}, p50={_percentile(analyses, 50):.1f}, "
        f"p95={_percentile(analyses, 95):.1f}"
    )
    print(
        "query_ms: "
        f"avg={statistics.mean(queries):.1f}, p50={_percentile(queries, 50):.1f}, "
        f"p95={_percentile(queries, 95):.1f}"
    )
    print(
        "compose_ms: "
        f"avg={statistics.mean(composes):.1f}, p50={_percentile(composes, 50):.1f}, "
        f"p95={_percentile(composes, 95):.1f}"
    )


if __name__ == "__main__":
    asyncio.run(main())
