"""Service for managing help tickets."""

from typing import List
from uuid import UUID

from core.models import Ticket
from core.repository.ticket_repository import TicketRepository
from core.service_registry import register_service
from core.services.base import CRUDService
from core.services.errors import NotFoundError, ValidationError
from schemas.tickets.tickets import TicketCreate, TicketUpdate
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class TicketService(CRUDService[Ticket]):
    """Service for managing help tickets."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = TicketRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "TicketService":
        return cls(db)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.repo.get_all()
            return True
        except Exception:
            return False

    async def create_ticket(self, data: TicketCreate) -> Ticket:
        """Create a new ticket."""
        try:
            return await self.repo.create(data.dict())
        except Exception as e:
            raise ValidationError(f"Failed to create ticket: {str(e)}")

    async def get_ticket(self, ticket_id: UUID) -> Ticket:
        """Get a ticket by ID."""
        ticket = await self.repo.get_by_id(ticket_id)
        if not ticket:
            raise NotFoundError("Ticket", ticket_id)
        return ticket

    async def update_ticket(self, ticket_id: UUID, data: TicketUpdate) -> Ticket:
        """Update a ticket."""
        _ = await self.get_ticket(ticket_id)

        try:
            return await self.repo.update(
                ticket_id, data.model_dump(exclude_unset=True)
            )
        except Exception as e:
            raise ValidationError(f"Failed to update ticket: {str(e)}")

    async def delete_ticket(self, ticket_id: UUID) -> None:
        """Delete a ticket."""
        _ = await self.get_ticket(ticket_id)

        try:
            await self.repo.delete(ticket_id)
        except Exception as e:
            raise ValidationError(f"Failed to delete ticket: {str(e)}")

    async def get_all_tickets(self) -> List[Ticket]:
        """Get all tickets."""
        return await self.repo.get_all()
