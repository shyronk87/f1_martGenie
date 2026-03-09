import asyncio

from src.model.query_data import query_products_from_analysis
from src.model.user_content_analysis import analyze_user_content


async def main() -> None:
    analysis = await analyze_user_content(
        [
            {
                "role": "user",
                "content": "I want a wood-style sofa for my living room, with a budget of $1500. I have two cats at home.",
            }
        ]
    )
    result = await query_products_from_analysis(analysis, limit=10)
    print(result.model_dump_json(ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
