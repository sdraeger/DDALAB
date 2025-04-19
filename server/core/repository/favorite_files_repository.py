from typing import List

from fastapi import Request
from sqlalchemy import select

from ..database import FavoriteFile
from .base_repository import BaseRepository


class FavoriteFileRepository(BaseRepository[FavoriteFile]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(FavoriteFile, request)

    @staticmethod
    def get_instance() -> "FavoriteFileRepository":
        if FavoriteFileRepository._instance is None:
            FavoriteFileRepository._instance = FavoriteFileRepository()
        return FavoriteFileRepository._instance

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[FavoriteFile]:
        stmt = select(FavoriteFile).filter(FavoriteFile.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_file_path(
        self, file_path: str, skip: int = 0, limit: int | None = None
    ) -> List[FavoriteFile]:
        stmt = (
            select(FavoriteFile)
            .filter(FavoriteFile.file_path == file_path)
            .offset(skip)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
