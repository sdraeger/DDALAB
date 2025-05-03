from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from ..database import Ticket
from ..dependencies import register_service
from ..repository import TicketRepository


@register_service
class TicketService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.ticket_repo = TicketRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "TicketService":
        return cls(db)

    async def get_ticket(self, ticket_id: int) -> Ticket:
        return await self.ticket_repo.get_by_id(ticket_id)

    async def get_tickets(
        self, skip: int = 0, limit: int | None = None
    ) -> List[Ticket]:
        return await self.ticket_repo.get_all(skip, limit)

    async def create_ticket(self, ticket: Ticket) -> Ticket:
        return await self.ticket_repo.create(ticket)

    async def update_ticket(self, ticket: Ticket) -> Ticket:
        return await self.ticket_repo.update(ticket)
