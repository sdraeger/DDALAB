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

    async def get_user_layouts(self, user_id: int) -> dict:
        """Get layouts for a user.

        Returns a dict with 'widgets' and 'layout' keys.
        Handles both new format (dict) and legacy format (list of widgets).
        """
        layout_row = await self.repo.get_by_user_id(user_id)
        if layout_row is None:
            return {"widgets": [], "layout": []}

        data = layout_row.layout_data
        # New format: persisted as a dict with expected keys
        if isinstance(data, dict):
            widgets = data.get("widgets", [])
            layout = data.get("layout", [])
            # Guard against legacy corruptions where widgets might not be a list
            if not isinstance(widgets, list):
                widgets = []
            if not isinstance(layout, list):
                layout = []
            return {"widgets": widgets, "layout": layout}

        # Legacy format: stored as a list of widgets directly
        if isinstance(data, list):
            return {"widgets": data, "layout": []}

        # Unexpected type: be defensive
        return {"widgets": [], "layout": []}

    async def save_user_layouts(
        self, user_id: int, widgets: List[dict], layout: List[dict]
    ) -> UserLayout:
        """Save or update layouts and widgets for a user."""
        if not widgets and not layout:
            raise ValueError("Widgets and layout cannot both be empty")

        # Store both widgets and layout as a single JSON object
        data_to_save = {"widgets": widgets, "layout": layout}
        return await self.repo.create_or_update_layout(user_id, data_to_save)

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
