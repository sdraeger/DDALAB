"""Script to delete orphaned artifacts."""

import asyncio

from core.environment import get_config_service
from core.models import Artifact
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

db_settings = get_config_service().get_database_settings()

# Database connection
engine = create_async_engine(
    f"postgresql+asyncpg://{db_settings.db_user}:{db_settings.db_password}"
    f"@{db_settings.db_host}:{db_settings.db_port}/{db_settings.db_name}"
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
