from typing import List

from core.dependencies import register_service
from core.repository.ticket_repository import TicketRepository
from schemas.tickets import Ticket
from sqlalchemy.ext.asyncio import AsyncSession


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

    async def get_tickets_by_user_id(self, user_id: int) -> List[Ticket]:
        return await self.ticket_repo.get_by_user_id(user_id)

    async def create_ticket(self, ticket: Ticket) -> Ticket:
        return await self.ticket_repo.create(ticket)

    async def update_ticket(self, ticket: Ticket) -> Ticket:
        return await self.ticket_repo.update(ticket)

    async def delete_ticket(self, ticket_id: int) -> None:
        return await self.ticket_repo.delete(ticket_id)
