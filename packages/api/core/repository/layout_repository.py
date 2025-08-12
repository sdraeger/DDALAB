"""Repository for managing user layouts."""

from core.models import UserLayout
from core.repository.base import BaseRepository
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class LayoutRepository(BaseRepository[UserLayout]):
    """Repository for managing user layouts."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, UserLayout)

    async def get_by_user_id(self, user_id: int) -> UserLayout | None:
        """Get a single layout for a user (there should be at most one)."""
        result = await self.db.execute(
            select(UserLayout).filter(UserLayout.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def create_or_update_layout(
        self, user_id: int, layout_data: dict
    ) -> UserLayout:
        """Create or update a layout for a user.

        Args:
            user_id: The user ID
            layout_data: Dictionary containing layout and widgets

        Returns:
            The created or updated layout
        """
        # Get existing layout
        result = await self.db.execute(
            select(UserLayout).filter(UserLayout.user_id == user_id)
        )
        layout = result.scalar_one_or_none()

        if layout:
            # Update existing layout
            layout.layout_data = layout_data
            await self.db.flush()
            await self.db.refresh(layout)
            return layout
        else:
            # Create new layout
            layout = UserLayout(user_id=user_id, layout_data=layout_data)
            self.db.add(layout)
            await self.db.flush()
            await self.db.refresh(layout)
            return layout

    async def delete_by_user_id(self, user_id: int) -> UserLayout | None:
        """Delete layouts for a user.

        Args:
            user_id: The user ID

        Returns:
            The deleted layout if found, None otherwise
        """
        result = await self.db.execute(
            select(UserLayout).filter(UserLayout.user_id == user_id)
        )
        layout = result.scalar_one_or_none()

        if layout:
            await self.db.delete(layout)
            await self.db.flush()
            return layout

        return None
