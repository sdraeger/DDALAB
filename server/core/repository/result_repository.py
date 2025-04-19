from typing import List

from fastapi import Request
from sqlalchemy import select

from .base_repository import BaseRepository
from .results import Result


class ResultRepository(BaseRepository[Result]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(Result, request)

    @staticmethod
    def get_instance() -> "ResultRepository":
        if ResultRepository._instance is None:
            ResultRepository._instance = ResultRepository()
        return ResultRepository._instance

    async def get_by_ticket_id(
        self, ticket_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Result]:
        stmt = select(Result).filter(Result.ticket_id == ticket_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Result]:
        stmt = select(Result).filter(Result.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
