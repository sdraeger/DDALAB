from typing import List

from core.database import Ticket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .base_repository import BaseRepository


class TicketRepository(BaseRepository[Ticket]):
    def __init__(self, db: AsyncSession):
        super().__init__(Ticket, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int = 100
    ) -> List[Ticket]:
        stmt = select(Ticket).filter(Ticket.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_status(
        self, status: str, skip: int = 0, limit: int = 100
    ) -> List[Ticket]:
        stmt = select(Ticket).filter(Ticket.status == status).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
