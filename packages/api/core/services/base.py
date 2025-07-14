from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class BaseService(ABC, Generic[T]):
    """Base class for all services."""

    def __init__(self, db: AsyncSession):
        self.db = db

    @classmethod
    @abstractmethod
    def from_db(cls, db: AsyncSession) -> "BaseService":
        """Factory method to create service instance."""
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        pass


class CRUDService(BaseService[T]):
    """Base class for services that provide CRUD operations."""

    @abstractmethod
    async def create(self, data: T) -> T:
        """Create a new record."""
        pass

    @abstractmethod
    async def get(self, id: int | str) -> T:
        """Get a record by ID."""
        pass

    @abstractmethod
    async def update(self, id: int | str, data: T) -> T:
        """Update a record."""
        pass

    @abstractmethod
    async def delete(self, id: int | str) -> None:
        """Delete a record."""
        pass
