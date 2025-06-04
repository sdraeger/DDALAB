from typing import List

from core.dependencies import register_service
from core.repository.user_repository import UserRepository
from schemas.user import User, UserCreate, UserUpdate
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class UserService:
    def __init__(self, db: AsyncSession):
        self.repo = UserRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "UserService":
        return cls(db)

    async def register_user(self, data: UserCreate) -> User:
        return await self.repo.create(data)

    async def get_user(
        self,
        user_id: int | None = None,
        username: str | None = None,
        email: str | None = None,
    ) -> User:
        if user_id:
            return await self.repo.get_by_user_id(user_id)
        if username:
            return await self.repo.get_by_username(username)
        if email:
            return await self.repo.get_by_email(email)
        raise ValueError("No valid identifier provided")

    async def update_user(
        self,
        data: UserUpdate,
        user_id: int | None = None,
        username: str | None = None,
        email: str | None = None,
    ) -> User:
        if user_id:
            return await self.repo.update(user_id, data)
        if username:
            return await self.repo.update_by_username(username, data)
        if email:
            return await self.repo.update_by_email(email, data)
        raise ValueError("No valid identifier provided")

    async def delete_user(
        self,
        user_id: int | None = None,
        username: str | None = None,
        email: str | None = None,
    ) -> User:
        if user_id:
            return await self.repo.delete(user_id)
        if username:
            return await self.repo.delete_by_username(username)
        if email:
            return await self.repo.delete_by_email(email)
        raise ValueError("No valid identifier provided")

    async def get_all_users(self) -> List[User]:
        return await self.repo.get_all()
