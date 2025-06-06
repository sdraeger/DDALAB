from contextlib import asynccontextmanager
from typing import Callable, Type, TypeVar

from fastapi import Depends, HTTPException
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import get_server_settings

T = TypeVar("T")

settings = get_server_settings()
_service_registry = {}

# Get PostgreSQL connection details from environment variables
DB_HOST = settings.db_host
DB_PORT = settings.db_port
DB_NAME = settings.db_name
DB_USER = settings.db_user
DB_PASSWORD = settings.db_password

# Create SQLAlchemy engine for PostgreSQL
SQLALCHEMY_DATABASE_URL = (
    f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)
engine = create_async_engine(SQLALCHEMY_DATABASE_URL, echo=True)
async_session_maker = async_sessionmaker(bind=engine, expire_on_commit=False)


@asynccontextmanager
async def get_db():
    """
    Dependency to get a database session in an async context
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db_session():
    """
    Dependency to get a database session in a Depends
    """
    async with get_db() as session:
        yield session


def register_service(
    service_class: Type[T] | None = None,
) -> Callable[[Type[T]], Type[T]] | Type[T]:
    """Decorator to register services and their dependencies"""

    def decorator(cls: Type[T]) -> Type[T]:
        # Create default factory if none exists
        if not hasattr(cls, "create"):

            def default_factory(db: AsyncSession) -> T:
                return cls(db)

            _service_registry[cls] = default_factory
        else:
            _service_registry[cls] = cls.create
        return cls

    if service_class is None:
        return decorator
    return decorator(service_class)


def get_service(service_class: Type[T]) -> Callable[[AsyncSession], T]:
    """Dependency injector for services"""

    def factory(db: AsyncSession = Depends(get_db_session)) -> T:
        if service_class not in _service_registry:
            raise ValueError(f"Service {service_class.__name__} not registered")
        return _service_registry[service_class](db)

    return factory


def get_artifact_service():
    """Custom dependency for ArtifactService that injects both DB and MinIO client"""
    from core.services.artifact_service import ArtifactService

    def factory(
        db: AsyncSession = Depends(get_db_session),
        minio_client: Minio = Depends(get_minio_client),
    ) -> ArtifactService:
        return ArtifactService(db, minio_client)

    return factory


def get_minio_client():
    """
    Initialize and yield a MinIO client instance.
    """
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

    yield client
