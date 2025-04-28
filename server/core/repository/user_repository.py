from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import User, UserPreferences
from .base_repository import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, db: AsyncSession):
        super().__init__(User, db)

    async def get_by_email(self, email: str) -> Optional[User]:
        stmt = select(User).filter(User.email == email)
        return (await self.db.execute(stmt)).scalars().first()

    async def get_by_username(self, username: str) -> Optional[User]:
        stmt = select(User).filter(User.username == username)
        return (await self.db.execute(stmt)).scalars().first()

    async def get_by_user_id(self, user_id: int) -> Optional[User]:
        stmt = select(User).filter(User.id == user_id)
        return (await self.db.execute(stmt)).scalars().first()

    async def get_user_preferences(self, user_id: int) -> Optional[UserPreferences]:
        stmt = select(UserPreferences).filter(UserPreferences.user_id == user_id)
        return (await self.db.execute(stmt)).scalars().first()

    async def get_all_with_preferences(
        self, skip: int = 0, limit: int | None = None
    ) -> List[User]:
        stmt = select(User).join(UserPreferences).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
