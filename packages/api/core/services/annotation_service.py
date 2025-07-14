"""Service for managing annotations."""

from typing import List, Optional

from core.models import Annotation
from core.repository.annotation_repository import AnnotationRepository
from core.service_registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class AnnotationService(BaseService[Annotation]):
    """Service for managing annotations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = AnnotationRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "AnnotationService":
        return cls(db)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.repo.get_all()
            return True
        except Exception:
            return False

    async def get_all(self) -> List[Annotation]:
        """Get all annotations."""
        return await self.repo.get_all()

    async def get_by_user_id(self, user_id: int) -> List[Annotation]:
        """Get all annotations for a user."""
        return await self.repo.get_by_user_id(user_id)

    async def get_by_file_id(self, file_id: str) -> List[Annotation]:
        """Get all annotations for a file."""
        return await self.repo.get_by_file_id(file_id)

    async def create(self, data: dict) -> Annotation:
        """Create a new annotation."""
        try:
            return await self.repo.create(data)
        except Exception as e:
            raise ValidationError(f"Failed to create annotation: {str(e)}")

    async def update(self, annotation_id: int, data: dict) -> Optional[Annotation]:
        """Update an annotation."""
        annotation = await self.repo.get_by_id(annotation_id)
        if not annotation:
            raise NotFoundError("Annotation", annotation_id)

        try:
            return await self.repo.update(annotation_id, data)
        except Exception as e:
            raise ValidationError(f"Failed to update annotation: {str(e)}")

    async def delete(self, annotation_id: int) -> bool:
        """Delete an annotation."""
        annotation = await self.repo.get_by_id(annotation_id)
        if not annotation:
            raise NotFoundError("Annotation", annotation_id)

        try:
            await self.repo.delete(annotation_id)
            return True
        except Exception as e:
            raise ValidationError(f"Failed to delete annotation: {str(e)}")
