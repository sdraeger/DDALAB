"""Local user service for managing the default user in local authentication mode."""

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from ..registry import register_service
from ..repository.user_repository import UserRepository
from .base import BaseService


@register_service
class LocalUserService(BaseService[User]):
    """Service for managing the default user in local authentication mode."""

    # Default user constants
    DEFAULT_USER_ID = "local-user"
    DEFAULT_USERNAME = "local"
    DEFAULT_EMAIL = "local@localhost"
    DEFAULT_FIRST_NAME = "Local"
    DEFAULT_LAST_NAME = "User"
    DEFAULT_IS_ADMIN = True
    DEFAULT_IS_ACTIVE = True

    def __init__(self, db: AsyncSession):
        """Initialize the service.

        Args:
            db: Database session
        """
        super().__init__(db)
        self.repository = UserRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "LocalUserService":
        """Create a new instance of the service.

        Args:
            db: Database session

        Returns:
            LocalUserService instance
        """
        return cls(db)

    async def ensure_default_user_exists(self) -> User:
        """Create or verify that the default user exists.

        This method checks if the default local user exists in the database.
        If not, it creates one with the predefined constants.

        Returns:
            The default user instance

        Raises:
            Exception: If user creation fails
        """
        # First try to get the existing default user
        existing_user = await self.repository.get_by_username(self.DEFAULT_USERNAME)

        if existing_user:
            # Ensure the existing user has the correct properties for local mode
            updated = False

            if not existing_user.is_admin:
                existing_user.is_admin = self.DEFAULT_IS_ADMIN
                updated = True

            if not existing_user.is_active:
                existing_user.is_active = self.DEFAULT_IS_ACTIVE
                updated = True

            if existing_user.email != self.DEFAULT_EMAIL:
                existing_user.email = self.DEFAULT_EMAIL
                updated = True

            if existing_user.first_name != self.DEFAULT_FIRST_NAME:
                existing_user.first_name = self.DEFAULT_FIRST_NAME
                updated = True

            if existing_user.last_name != self.DEFAULT_LAST_NAME:
                existing_user.last_name = self.DEFAULT_LAST_NAME
                updated = True

            if updated:
                existing_user.updated_at = datetime.now(timezone.utc).replace(
                    tzinfo=None
                )
                await self.db.flush()
                await self.db.refresh(existing_user)

            return existing_user

        # Create new default user
        default_user = User(
            username=self.DEFAULT_USERNAME,
            email=self.DEFAULT_EMAIL,
            first_name=self.DEFAULT_FIRST_NAME,
            last_name=self.DEFAULT_LAST_NAME,
            is_admin=self.DEFAULT_IS_ADMIN,
            is_active=self.DEFAULT_IS_ACTIVE,
            password_hash="",  # No password needed in local mode
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )

        return await self.repository.create(default_user)

    async def get_default_user(self) -> User:
        """Retrieve the local mode default user.

        This method returns the default user for local mode. If the user
        doesn't exist, it will be created automatically.

        Returns:
            The default user instance

        Raises:
            Exception: If user retrieval or creation fails
        """
        return await self.ensure_default_user_exists()

    async def health_check(self) -> bool:
        """Check if the service is healthy.

        Returns:
            True if the service can access the database and manage users
        """
        try:
            # Try to get or create the default user
            await self.get_default_user()
            return True
        except Exception:
            return False
