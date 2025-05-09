from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .base_repository import BaseRepository
from .files import File


class FileRepository(BaseRepository[File]):
    def __init__(self, db: AsyncSession):
        super().__init__(File, db)

    async def get_by_ticket_id(
        self, ticket_id: int, skip: int = 0, limit: int | None = None
    ) -> List[File]:
        query = self.db.execute(
            select(File).filter(File.ticket_id == ticket_id).offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return await query.scalars().all()

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[File]:
        query = self.db.execute(
            select(File).filter(File.user_id == user_id).offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return await query.scalars().all()
