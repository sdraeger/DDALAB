"""Service for managing widget layouts."""

from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import UserLayout
from ..repository.layout_repository import LayoutRepository
from ..service_registry import register_service
from .base import BaseService


@register_service
class WidgetLayoutService(BaseService):
    """Service for managing widget layouts."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = LayoutRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "WidgetLayoutService":
        return cls(db)

    async def get_user_layouts(self, user_id: int) -> List[dict]:
        """Get layouts for a user."""
        layouts = await self.repo.get_by_user_id(user_id)
        if not layouts:
            return []

        # Handle case where multiple layouts are returned
        if isinstance(layouts, list):
            # Get the most recent layout
            layout = layouts[0] if layouts else None
            if not layout:
                return []
            return layout.layout_data if isinstance(layout.layout_data, list) else []

        # Handle case where a single layout is returned
        return layouts.layout_data if isinstance(layouts.layout_data, list) else []

    async def save_user_layouts(self, user_id: int, layouts: List[dict]) -> UserLayout:
        """Save or update layouts for a user."""
        if not layouts:
            raise ValueError("Layouts list cannot be empty")

        return await self.repo.create_or_update_layout(user_id, layouts)

    async def delete_user_layouts(self, user_id: int) -> Optional[UserLayout]:
        """Delete layouts for a user."""
        return await self.repo.delete_by_user_id(user_id)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            # Try to execute a simple query to check database connectivity
            await self.db.execute("SELECT 1")
            return True
        except Exception:
            return False
