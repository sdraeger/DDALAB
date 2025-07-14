"""Repository for managing help tickets."""

from typing import List, Optional
from uuid import UUID

from core.models import Ticket
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class TicketRepository(BaseRepository[Ticket]):
    """Repository for managing help tickets."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, Ticket)

    async def get_by_user_id(self, user_id: int) -> List[Ticket]:
        """Get all tickets for a user."""
        return await self.get_by_field("user_id", user_id)

    async def get_by_id(self, ticket_id: UUID) -> Optional[Ticket]:
        """Get a ticket by ID."""
        return await self.get_by_field("id", ticket_id)
