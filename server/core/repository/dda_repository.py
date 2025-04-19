from typing import List, Optional

from fastapi import Request
from sqlalchemy import select

from .base_repository import BaseRepository
from .dda import DDA


class DDARepository(BaseRepository[DDA]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(DDA, request)

    @staticmethod
    def get_instance() -> "DDARepository":
        if DDARepository._instance is None:
            DDARepository._instance = DDARepository()
        return DDARepository._instance

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int = 100
    ) -> List[DDA]:
        stmt = select(DDA).filter(DDA.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_ticket_id(self, ticket_id: int) -> Optional[DDA]:
        stmt = select(DDA).filter(DDA.ticket_id == ticket_id)
        return (await self.db.execute(stmt)).scalars().first()
