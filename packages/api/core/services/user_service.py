from typing import List

from core.dependencies import register_service
from core.repository.user_repository import UserRepository
from core.security import get_password_hash
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
        # Hash the password before storing
        hashed_password = get_password_hash(data.password)

        # Create the database model directly with proper field mapping
        from core.database import User as UserDB

        user_db = UserDB(
            username=data.username,
            password_hash=hashed_password,  # Map password to password_hash
            email=data.email,
            first_name=data.first_name,
            last_name=data.last_name,
            is_admin=data.is_admin,
        )

        # Add to database
        self.repo.db.add(user_db)
        await self.repo.db.commit()
        await self.repo.db.refresh(user_db)
        return user_db

    # Alias for routes compatibility
    async def create_user(self, data: UserCreate) -> User:
        return await self.register_user(data)

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
        # First, get the user object
        if user_id:
            user = await self.repo.get_by_user_id(user_id)
        elif username:
            user = await self.repo.get_by_username(username)
        elif email:
            user = await self.repo.get_by_email(email)
        else:
            raise ValueError("No valid identifier provided")

        if not user:
            raise ValueError("User not found")

            # Handle password hashing if password is being updated
        update_dict = data.model_dump(exclude_unset=True)
        if "password" in update_dict and update_dict["password"]:
            # Hash the password and map to password_hash field
            update_dict["password_hash"] = get_password_hash(update_dict["password"])
            del update_dict["password"]

        # Apply updates directly to the user object
        for key, value in update_dict.items():
            if hasattr(user, key):
                setattr(user, key, value)

        await self.repo.db.commit()
        await self.repo.db.refresh(user)
        return user

    # Alias for routes compatibility
    async def update(self, user_id: int, data: UserUpdate) -> User:
        return await self.update_user(data, user_id=user_id)

    async def delete_user(
        self,
        user_id: int | None = None,
        username: str | None = None,
        email: str | None = None,
    ) -> User:
        if user_id:
            return await self.repo.delete(user_id)
        elif username:
            user = await self.repo.get_by_username(username)
            if user:
                return await self.repo.delete(user.id)
        elif email:
            user = await self.repo.get_by_email(email)
            if user:
                return await self.repo.delete(user.id)
        else:
            raise ValueError("No valid identifier provided")

        return None

    # Alias for routes compatibility
    async def delete(self, user_id: int) -> User:
        return await self.delete_user(user_id=user_id)

    async def get_all_users(self) -> List[User]:
        return await self.repo.get_all()
