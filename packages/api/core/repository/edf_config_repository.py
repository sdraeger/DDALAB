from typing import List, Optional

from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...schemas.config import EdfConfigCreate
from ..database import EdfConfig
from .base_repository import BaseRepository


class EdfConfigRepository(BaseRepository[EdfConfig]):
    def __init__(self, db: AsyncSession):
        super().__init__(EdfConfig, db)

    async def create(self, edf_config: EdfConfigCreate) -> EdfConfig:
        try:
            result = await self.db.execute(
                insert(EdfConfig).values(**edf_config.model_dump()).returning(EdfConfig)
            )
            await self.db.commit()
            return result.scalar_one()
        except IntegrityError as e:
            raise ValueError(f"Failed to create config: {str(e)}")

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
    ) -> EdfConfig | None:
        stmt = select(EdfConfig).filter(
            EdfConfig.user_id == user_id, EdfConfig.file_hash == file_hash
        )
        return (await self.db.execute(stmt)).scalars().first()
