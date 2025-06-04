from typing import List, Optional

from core.database import UserLayout
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .base_repository import BaseRepository


class LayoutRepository(BaseRepository[UserLayout]):
    def __init__(self, db: AsyncSession):
        super().__init__(UserLayout, db)

    async def get_by_user_id(self, user_id: int) -> Optional[UserLayout]:
        """Get layout by user ID."""
        stmt = select(UserLayout).filter(UserLayout.user_id == user_id)
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def create_or_update_layout(
        self, user_id: int, layout_data: List[dict]
    ) -> UserLayout:
        """Create a new layout or update existing one for a user."""
        existing_layout = await self.get_by_user_id(user_id)

        if existing_layout:
            existing_layout.layout_data = layout_data
            await self.db.commit()
            await self.db.refresh(existing_layout)
            return existing_layout
        else:
            new_layout = UserLayout(user_id=user_id, layout_data=layout_data)
            self.db.add(new_layout)
            await self.db.commit()
            await self.db.refresh(new_layout)
            return new_layout

    async def delete_by_user_id(self, user_id: int) -> Optional[UserLayout]:
        """Delete layout by user ID."""
        layout = await self.get_by_user_id(user_id)
        if layout:
            await self.db.delete(layout)
            await self.db.commit()
        return layout
