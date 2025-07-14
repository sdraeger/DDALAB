from sqlalchemy.ext.asyncio import AsyncSession

from ..models import UserPreferences
from ..repository import UserPreferencesRepository
from ..service_registry import register_service
from .base import BaseService


@register_service
class UserPreferencesService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = UserPreferencesRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "UserPreferencesService":
        return cls(db)

    async def get_preferences(self, user_id: int) -> UserPreferences | None:
        return await self.repo.get_by_user_id(user_id)

    async def update_preferences(
        self, user_id: int, preferences: dict
    ) -> UserPreferences:
        return await self.repo.update_preferences(user_id, preferences)

    async def reset_to_defaults(self, user_id: int) -> UserPreferences | None:
        return await self.repo.reset_to_defaults(user_id)

    async def health_check(self) -> bool:
        """Check if the service is healthy.

        Returns:
            bool: True if the service is healthy, False otherwise
        """
        try:
            # Try to execute a simple query to check database connectivity
            await self.db.execute("SELECT 1")
            return True
        except Exception:
            return False
