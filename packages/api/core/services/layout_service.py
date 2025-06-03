from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from ..database import UserLayout
from ..dependencies import register_service
from ..repository.layout_repository import LayoutRepository


@register_service
class LayoutService:
    def __init__(self, db: AsyncSession):
        self.repo = LayoutRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "LayoutService":
        return cls(db)

    async def get_user_layouts(self, user_id: int) -> List[dict]:
        """Get layouts for a user."""
        layout = await self.repo.get_by_user_id(user_id)
        if not layout:
            return []

        # Return the raw layout_data as list of dicts
        return layout.layout_data

    async def save_user_layouts(self, user_id: int, layouts: List[dict]) -> UserLayout:
        """Save or update layouts for a user."""
        if not layouts:
            raise ValueError("Layouts list cannot be empty")

        return await self.repo.create_or_update_layout(user_id, layouts)

    async def delete_user_layouts(self, user_id: int) -> UserLayout | None:
        """Delete layouts for a user."""
        return await self.repo.delete_by_user_id(user_id)
