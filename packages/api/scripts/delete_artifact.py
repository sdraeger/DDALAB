"""Script to delete an artifact."""

import asyncio
import sys

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
