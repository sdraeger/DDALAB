from sqlalchemy.ext.asyncio import AsyncSession

from ..database import UserPreferences
from ..dependencies import register_service
from ..repository import UserPreferencesRepository


@register_service
class UserPreferencesService:
    def __init__(self, db: AsyncSession):
        self.repo = UserPreferencesRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "UserPreferencesService":
        return cls(db)

    async def get_preferences(self, user_id: int) -> UserPreferences | None:
        return await self.repo.get_by_user_id(user_id)

    async def update_preferences(
        self, user_id: int, preferences: dict
    ) -> UserPreferences:
        return await self.repo.update_preferences(user_id, preferences)

    async def reset_to_defaults(self, user_id: int) -> UserPreferences | None:
        return await self.repo.reset_to_defaults(user_id)
