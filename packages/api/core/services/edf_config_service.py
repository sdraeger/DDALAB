"""Service for managing EDF configurations."""

from core.repository.edf_config_repository import EdfConfigRepository
from core.service_registry import register_service
from core.services.base import BaseService
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class EdfConfigService(BaseService):
    """Service for managing EDF configurations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = EdfConfigRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "EdfConfigService":
        return cls(db)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.repo.get_all()
            return True
        except Exception:
            return False
