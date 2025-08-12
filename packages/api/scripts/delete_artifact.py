"""Script to delete an artifact."""

import asyncio
import sys

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


async def delete_artifact(session: AsyncSession, artifact_id: str) -> bool:
    """Delete an artifact from the database."""
    result = await session.execute(select(Artifact).filter(Artifact.id == artifact_id))
    artifact = result.scalar_one_or_none()
    if artifact:
        await session.delete(artifact)
        await session.commit()
        return True
    return False


async def main():
    """Main function."""
    if len(sys.argv) != 2:
        print("Usage: python delete_artifact.py <artifact_id>")
        sys.exit(1)

    artifact_id = sys.argv[1]

    async with AsyncSession(engine) as session:
        deleted = await delete_artifact(session, artifact_id)
        if deleted:
            logger.info(f"Artifact {artifact_id} deleted from the database")
        else:
            logger.warning(f"Artifact {artifact_id} not found in the database")


if __name__ == "__main__":
    asyncio.run(main())
