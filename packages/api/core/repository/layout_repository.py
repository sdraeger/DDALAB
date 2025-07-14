"""Repository for managing user layouts."""

from core.models import UserLayout
from core.repository.base import BaseRepository
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class LayoutRepository(BaseRepository[UserLayout]):
    """Repository for managing user layouts."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, UserLayout)

    async def get_by_user_id(self, user_id: int):
        """Get all layouts for a user."""
        return await self.get_by_field("user_id", user_id)

    async def create_or_update_layout(
        self, user_id: int, layout_data: list
    ) -> UserLayout:
        """Create or update a layout for a user.

        Args:
            user_id: The user ID
            layout_data: List of layout items

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
