"""Base repository class for database operations."""

from typing import Any, Dict, Generic, List, Optional, Type, TypeVar

from core.models import Base
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """Base repository class with common CRUD operations."""

    def __init__(self, db: AsyncSession, model: Type[ModelType]):
        """Initialize the repository.

        Args:
            db: Database session
            model: SQLAlchemy model class
        """
        self.db = db
        self.model = model

    async def get_by_id(self, id: Any) -> Optional[ModelType]:
        """Get a record by ID."""
        result = await self.db.execute(select(self.model).filter(self.model.id == id))
        return result.scalar_one_or_none()

    async def get_by_field(self, field: str, value: Any) -> List[ModelType]:
        """Get records by field value."""
        result = await self.db.execute(
            select(self.model).filter(getattr(self.model, field) == value)
        )
        return result.scalars().all()

    async def get_by_fields(self, field_values: Dict[str, Any]) -> Optional[ModelType]:
        """Get a single record by multiple field values."""
        query = select(self.model)
        for field, value in field_values.items():
            query = query.filter(getattr(self.model, field) == value)

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_all(self) -> List[ModelType]:
        """Get all records."""
        result = await self.db.execute(select(self.model))
        return result.scalars().all()

    async def create(self, obj: ModelType) -> ModelType:
        """Create a new record."""
        self.db.add(obj)
        await self.db.flush()
        await self.db.refresh(obj)
        return obj

    async def update(self, obj: ModelType) -> ModelType:
        """Update a record."""
        await self.db.merge(obj)
        await self.db.flush()
        await self.db.refresh(obj)
        return obj

    async def delete(self, obj: ModelType) -> None:
        """Delete a record."""
        await self.db.delete(obj)
        await self.db.flush()

    async def delete_by_id(self, id: Any) -> None:
        """Delete a record by ID."""
        obj = await self.get_by_id(id)
        if obj:
            await self.delete(obj)
