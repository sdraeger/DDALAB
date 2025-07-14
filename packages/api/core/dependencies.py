"""FastAPI dependencies."""

from typing import Callable, Type, TypeVar

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .database import async_session_maker
from .registry import get_service_factory
from .services.base import BaseService

T = TypeVar("T", bound=BaseService)


async def get_db() -> AsyncSession:
    """Get a database session.

    Returns:
        AsyncSession: Database session
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def get_service(service_class: Type[T]) -> Callable[[AsyncSession], T]:
    """Dependency injector for services.

    Args:
        service_class: The service class to get an instance of

    Returns:
        A callable that creates a service instance
    """

    def get_instance(db: AsyncSession = Depends(get_db)) -> T:
        factory = get_service_factory(service_class)
        return factory(db)

    return get_instance
