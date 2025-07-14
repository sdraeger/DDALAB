"""Repository for managing users."""

from datetime import datetime, timezone
from typing import Optional

from core.models import User
from core.repository.base import BaseRepository
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class UserRepository(BaseRepository[User]):
    """Repository for managing users."""

    def __init__(self, db: AsyncSession):
        """Initialize the repository with User model."""
        super().__init__(db, User)

    async def get_by_username(self, username: str) -> Optional[User]:
        """Get a user by username.

        Args:
            username: The username to look up

        Returns:
            The user if found, None otherwise
        """
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def update_last_login(self, user: User) -> User:
        """Update the last login timestamp for a user.

        Args:
            user: The user to update

        Returns:
            The updated user
        """
        user.last_login = datetime.now(timezone.utc).replace(tzinfo=None)
        await self.db.flush()
        return user
