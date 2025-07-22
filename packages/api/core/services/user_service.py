"""User service module."""

from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from ..registry import register_service
from ..repository.user_repository import UserRepository
from .base import BaseService


@register_service
class UserService(BaseService[User]):
    """User service class."""

    def __init__(self, db: AsyncSession):
        """Initialize the service."""
        super().__init__(db)
        self.repository = UserRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "UserService":
        """Create a new instance of the service."""
        return cls(db)

    async def get_user(self, username: str) -> Optional[User]:
        """Get a user by username.

        Args:
            username: The username to look up

        Returns:
            The user if found, None otherwise
        """
        return await self.repository.get_by_username(username)

    async def get_all(self) -> List[User]:
        """Get all users.

        Returns:
            List of all users
        """
        return await self.repository.get_all()

    async def update_last_login(self, user: User) -> User:
        """Update the last login timestamp for a user.

        Args:
            user: The user to update

        Returns:
            The updated user
        """
        return await self.repository.update_last_login(user)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.repository.get_all()
            return True
        except Exception:
            return False


class DummyUserService(UserService):
    async def create(self, *args, **kwargs):
        pass

    async def get_all(self, *args, **kwargs):
        return []

    async def get_all_users(self, *args, **kwargs):
        return []

    async def health_check(self):
        return True
