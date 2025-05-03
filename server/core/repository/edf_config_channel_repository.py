from typing import List

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...schemas.config import EdfConfigChannelCreate
from ..database import EdfConfig, EdfConfigChannel
from .base_repository import BaseRepository


class EdfConfigChannelRepository(BaseRepository[EdfConfigChannel]):
    def __init__(self, db: AsyncSession):
        super().__init__(EdfConfigChannel, db)

    async def create(self, edf_config: EdfConfigChannelCreate) -> EdfConfigChannel:
        data = edf_config.model_dump()
        channels = data.pop("channels", [])
        inserted = None
        for channel in channels:
            inserted = (
                await self.db.execute(
                    insert(EdfConfigChannel).values(
                        config_id=data["config_id"], channel=channel
                    )
                )
            ).scalar_one()
        await self.db.commit()
        return inserted

    async def get_by_config_id(
        self, config_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfigChannel]:
        query = self.db.execute(
            select(EdfConfigChannel)
            .filter(EdfConfigChannel.config_id == config_id)
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return (await query).scalars().all()

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfigChannel]:
        query = self.db.execute(
            select(EdfConfigChannel)
            .join(
                EdfConfigChannel.config,
                onclause=EdfConfigChannel.config_id == EdfConfig.id,
            )
            .filter(EdfConfig.user_id == user_id)
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return await query.scalars().all()

    async def delete_by_config_id(self, config_id: int) -> None:
        await self.db.execute(
            delete(EdfConfigChannel).where(EdfConfigChannel.config_id == config_id)
        )
        await self.db.commit()
