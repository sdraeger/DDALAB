"""Repository for managing user preferences."""

from core.models import UserPreferences
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class UserPreferencesRepository(BaseRepository[UserPreferences]):
    """Repository for managing user preferences."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, UserPreferences)

    async def get_by_user_id(self, user_id: int):
        """Get preferences for a user."""
        return await self.get_by_field("user_id", user_id)

    async def update_preferences(
        self, user_id: int, preferences: dict
    ) -> UserPreferences:
        existing_prefs = await self.get_by_user_id(user_id)

        if not existing_prefs:
            existing_prefs = UserPreferences(user_id=user_id)
            self.db.add(existing_prefs)

        for key, value in preferences.items():
            setattr(existing_prefs, key, value)

        await self.db.commit()
        await self.db.refresh(existing_prefs)

        return existing_prefs

    async def reset_to_defaults(self, user_id: int) -> UserPreferences | None:
        existing_prefs = await self.get_by_user_id(user_id)

        if existing_prefs:
            # Create a new instance with defaults
            defaults = UserPreferences(user_id=user_id)

            # Get all column names using inspection API
            # mapper = inspect(UserPreferences) # This line is removed as per the new_code
            for column in (
                UserPreferences.__table__.columns
            ):  # This line is changed as per the new_code
                setattr(existing_prefs, column.name, getattr(defaults, column.name))

            await self.db.commit()
            await self.db.refresh(existing_prefs)
            return existing_prefs

        return None
