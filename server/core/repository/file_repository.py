from typing import List

from fastapi import Request
from sqlalchemy import select

from .base_repository import BaseRepository
from .files import File


class FileRepository(BaseRepository[File]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(File, request)

    @staticmethod
    def get_instance() -> "FileRepository":
        if FileRepository._instance is None:
            FileRepository._instance = FileRepository()
        return FileRepository._instance

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
