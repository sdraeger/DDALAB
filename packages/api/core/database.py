"""Database configuration and session management."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import HTTPException
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import get_server_settings

settings = get_server_settings()

# Create SQLAlchemy engine for PostgreSQL
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_size=20,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get a database session.

    Returns:
        AsyncSession: Database session

    Example:
        async with get_db() as db:
            result = await db.execute(query)
            await db.commit()
    """
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# Alias for dependency injection
get_db_session = get_db


def get_minio_client():
    """Initialize and yield a MinIO client instance."""
    endpoint = settings.minio_host
    access_key = settings.minio_access_key
    secret_key = settings.minio_secret_key
    secure = False

    if not access_key or not secret_key:
        raise HTTPException(
            status_code=500,
            detail="MinIO credentials not configured",
        )

    client = Minio(
        endpoint,
        access_key=access_key,
        secret_key=secret_key,
        secure=secure,
    )

    # Ensure the bucket exists
    try:
        if not client.bucket_exists(settings.minio_bucket_name):
            client.make_bucket(settings.minio_bucket_name)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initialize MinIO bucket: {str(e)}",
        )

    return client
