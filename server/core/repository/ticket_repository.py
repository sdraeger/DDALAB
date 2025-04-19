from typing import List

from fastapi import Request
from sqlalchemy import select

from ..database import Ticket
from .base_repository import BaseRepository


class TicketRepository(BaseRepository[Ticket]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(Ticket, request)

    @staticmethod
    def get_instance() -> "TicketRepository":
        if TicketRepository._instance is None:
            TicketRepository._instance = TicketRepository()
        return TicketRepository._instance

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
