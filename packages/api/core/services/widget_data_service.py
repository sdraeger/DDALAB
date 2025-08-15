"""Service for managing widget data storage."""

from typing import Any, Dict, Optional

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import WidgetData
from ..service_registry import register_service
from .base import BaseService


@register_service
class WidgetDataService(BaseService):
    """Service for managing widget data storage."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "WidgetDataService":
        return cls(db)

    async def store_widget_data(
        self,
        user_id: int,
        data_key: str,
        widget_data: Any,
        widget_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WidgetData:
        """Store widget data for a user."""
        # Check if data already exists
        stmt = select(WidgetData).where(
            WidgetData.user_id == user_id,
            WidgetData.data_key == data_key,
        )
        result = await self.db.execute(stmt)
        existing_data = result.scalar_one_or_none()

        if existing_data:
            # Update existing data
            update_stmt = (
                update(WidgetData)
                .where(WidgetData.id == existing_data.id)
                .values(
                    widget_data=widget_data,
                    widget_id=widget_id,
                    widget_metadata=metadata or {},
                )
            )
            await self.db.execute(update_stmt)
            await self.db.commit()
            await self.db.refresh(existing_data)
            return existing_data
        else:
            # Create new data record
            widget_data_record = WidgetData(
                user_id=user_id,
                data_key=data_key,
                widget_data=widget_data,
                widget_id=widget_id,
                widget_metadata=metadata or {},
            )
            self.db.add(widget_data_record)
            await self.db.commit()
            await self.db.refresh(widget_data_record)
            return widget_data_record

    async def get_widget_data(
        self, user_id: int, data_key: str
    ) -> Optional[Dict[str, Any]]:
        """Get widget data for a user by key."""
        stmt = select(WidgetData).where(
            WidgetData.user_id == user_id,
            WidgetData.data_key == data_key,
        )
        result = await self.db.execute(stmt)
        widget_data = result.scalar_one_or_none()

        if widget_data:
            return {
                "data": widget_data.widget_data,
                "widget_id": widget_data.widget_id,
                "metadata": widget_data.widget_metadata,
                "created_at": (
                    widget_data.created_at.isoformat()
                    if widget_data.created_at
                    else None
                ),
                "updated_at": (
                    widget_data.updated_at.isoformat()
                    if widget_data.updated_at
                    else None
                ),
            }

        return None

    async def delete_widget_data(self, user_id: int, data_key: str) -> bool:
        """Delete widget data for a user by key."""
        stmt = delete(WidgetData).where(
            WidgetData.user_id == user_id,
            WidgetData.data_key == data_key,
        )
        result = await self.db.execute(stmt)
        await self.db.commit()
        return result.rowcount > 0

    async def delete_all_widget_data(self, user_id: int) -> int:
        """Delete all widget data for a user."""
        stmt = delete(WidgetData).where(WidgetData.user_id == user_id)
        result = await self.db.execute(stmt)
        await self.db.commit()
        return result.rowcount

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            # Try to execute a simple query to check database connectivity
            await self.db.execute("SELECT 1")
            return True
        except Exception:
            return False
