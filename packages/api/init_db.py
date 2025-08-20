#!/usr/bin/env python
"""Initialize the database with tables."""

import asyncio
import sys
from pathlib import Path

# Add the API package to the path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy.ext.asyncio import create_async_engine
from core.models import Base
from core.environment import get_config_service


async def init_database():
    """Create all database tables."""
    settings = get_config_service().get_database_settings()
    
    print(f"Initializing database at: {settings.connection_url}")
    
    # Create engine
    engine = create_async_engine(
        settings.connection_url,
        echo=True,
    )
    
    async with engine.begin() as conn:
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        print("Database tables created successfully!")
    
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_database())