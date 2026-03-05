import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from src.web.auth.config import settings


async def main() -> None:
    database_url = settings.database_url
    print("DATABASE_URL loaded:", database_url)

    engine = create_async_engine(database_url, echo=False)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text("SELECT 1"))
            value = result.scalar_one()
            print("Database connection ok. SELECT 1 ->", value)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
