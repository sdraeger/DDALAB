from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .base_repository import BaseRepository
from .dda import DDA


class DDARepository(BaseRepository[DDA]):
    def __init__(self, db: AsyncSession):
        super().__init__(DDA, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[DDA]:
        stmt = select(DDA).filter(DDA.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_ticket_id(self, ticket_id: int) -> Optional[DDA]:
        stmt = select(DDA).filter(DDA.ticket_id == ticket_id)
        return (await self.db.execute(stmt)).scalars().first()
