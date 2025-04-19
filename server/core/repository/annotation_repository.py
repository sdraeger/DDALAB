from typing import List

from fastapi import Request
from sqlalchemy import select

from ..database import Annotation
from .base_repository import BaseRepository


class AnnotationRepository(BaseRepository[Annotation]):
    _instance = None

    def __init__(self, request: Request):
        super().__init__(Annotation, request)

    @staticmethod
    def get_instance() -> "AnnotationRepository":
        if AnnotationRepository._instance is None:
            AnnotationRepository._instance = AnnotationRepository()
        return AnnotationRepository._instance

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Annotation]:
        stmt = select(Annotation).filter(Annotation.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_file_path(
        self, file_path: str, skip: int = 0, limit: int | None = None
    ) -> List[Annotation]:
        stmt = select(Annotation).filter(Annotation.file_path == file_path).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
