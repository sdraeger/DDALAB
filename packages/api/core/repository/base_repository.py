from typing import Generic, List, Optional, Type, TypeVar

from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

T = TypeVar("T")


class BaseRepository(Generic[T]):
    def __init__(self, model: Type[T], db: AsyncSession):
        self.model = model
        self.db = db

    async def create(self, obj_in: BaseModel) -> T:
        logger.debug(f"obj_in: {obj_in}")
        model_dict = obj_in.model_dump()
        logger.debug(f"model_dict: {model_dict}")

        db_obj = self.model(**model_dict)
        logger.debug(f"db_obj: {db_obj}")
        self.db.add(db_obj)
        logger.debug("db_obj added")
        await self.db.commit()
        logger.debug("db_obj committed")
        await self.db.refresh(db_obj)
        logger.debug("db_obj refreshed")
        return db_obj

    async def get_by_id(self, id: int) -> Optional[T]:
        return (
            (await self.db.execute(select(self.model).filter(self.model.id == id)))
            .scalars()
            .first()
        )

    async def get_all(self, skip: int = 0, limit: int | None = None) -> List[T]:
        query = self.db.execute(select(self.model).offset(skip))
        if limit is not None:
            query = query.limit(limit)
        return await query.all()

    async def update(self, db_obj: T, obj_in: BaseModel) -> T:
        for key, value in obj_in.model_dump().items():
            if hasattr(db_obj, key):
                setattr(db_obj, key, value)
        await self.db.commit()
        await self.db.refresh(db_obj)
        return db_obj

    async def delete(self, id: int) -> Optional[T]:
        db_obj = await self.get_by_id(id)
        if db_obj:
            await self.db.delete(db_obj)
            await self.db.commit()
        return db_obj
