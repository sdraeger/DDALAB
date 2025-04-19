from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import EdfConfig
from .base_repository import BaseRepository


class EdfConfigRepository(BaseRepository[EdfConfig]):
    _instance = None

    def __init__(self, db: AsyncSession):
        super().__init__(EdfConfig, db)

    @staticmethod
    def get_instance() -> "EdfConfigRepository":
        if EdfConfigRepository._instance is None:
            EdfConfigRepository._instance = EdfConfigRepository()
        return EdfConfigRepository._instance

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfig]:
        stmt = select(EdfConfig).filter(EdfConfig.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_file_hash(self, file_hash: str) -> Optional[EdfConfig]:
        stmt = select(EdfConfig).filter(EdfConfig.file_hash == file_hash)
        return (await self.db.execute(stmt)).scalars().first()

    async def get_by_user_id_and_file_hash(
        self, user_id: int, file_hash: str
    ) -> Optional[EdfConfig]:
        stmt = select(EdfConfig).filter(
            EdfConfig.user_id == user_id, EdfConfig.file_hash == file_hash
        )
        return (await self.db.execute(stmt)).scalars().first()
