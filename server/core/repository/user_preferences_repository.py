from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import UserPreferences
from ..utils.utils import camel_to_snake
from .base_repository import BaseRepository


class UserPreferencesRepository(BaseRepository[UserPreferences]):
    def __init__(self, db: AsyncSession):
        super().__init__(UserPreferences, db)

    async def get_by_user_id(self, user_id: int) -> UserPreferences | None:
        stmt = select(UserPreferences).filter(UserPreferences.user_id == user_id)
        return (await self.db.execute(stmt)).scalars().first()

    async def update_preferences(
        self, user_id: int, preferences: dict
    ) -> UserPreferences:
        existing_prefs = await self.get_by_user_id(user_id)

        if not existing_prefs:
            existing_prefs = UserPreferences(user_id=user_id)
            await self.db.add(existing_prefs)

        for key, value in preferences.items():
            setattr(existing_prefs, camel_to_snake(key), value)

        await self.db.commit()
        await self.db.refresh(existing_prefs)

        return existing_prefs

    async def reset_to_defaults(self, user_id: int) -> UserPreferences | None:
        existing_prefs = await self.get_by_user_id(user_id)

        if existing_prefs:
            # Create a new instance with defaults
            defaults = UserPreferences(user_id=user_id)

            # Get all column names using inspection API
            mapper = inspect(UserPreferences)
            for column in mapper.columns:
                setattr(existing_prefs, column.name, getattr(defaults, column.name))

            await self.db.commit()
            await self.db.refresh(existing_prefs)
            return existing_prefs
        return None
