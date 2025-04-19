from typing import List

from fastapi import Request
from sqlalchemy import select

from ..database import EdfConfigChannel
from .base_repository import BaseRepository


class EdfConfigChannelRepository(BaseRepository[EdfConfigChannel]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(EdfConfigChannel, request)

    @staticmethod
    def get_instance() -> "EdfConfigChannelRepository":
        if EdfConfigChannelRepository._instance is None:
            EdfConfigChannelRepository._instance = EdfConfigChannelRepository()
        return EdfConfigChannelRepository._instance

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
        return await query.scalars().all()

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfigChannel]:
        query = self.db.execute(
            select(EdfConfigChannel)
            .filter(EdfConfigChannel.user_id == user_id)
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return await query.scalars().all()
