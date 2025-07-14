"""Script to delete orphaned artifacts."""

import asyncio

from core.config import get_server_settings
from core.models import Artifact
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

settings = get_server_settings()

# Database connection
engine = create_async_engine(
    f"postgresql+asyncpg://{settings.db_user}:{settings.db_password}"
    f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
)


async def delete_orphaned_artifacts(session: AsyncSession) -> int:
    """Delete orphaned artifacts from the database."""
    result = await session.execute(select(Artifact).filter(Artifact.user_id.is_(None)))
    artifacts = result.scalars().all()
    for artifact in artifacts:
        await session.delete(artifact)
    await session.commit()
    return len(artifacts)


async def main():
    """Main function."""
    async with AsyncSession(engine) as session:
        count = await delete_orphaned_artifacts(session)
        logger.info(f"Deleted {count} orphaned artifacts from the database")


if __name__ == "__main__":
    asyncio.run(main())
