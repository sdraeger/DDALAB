"""GraphQL mutations."""

from typing import Optional

import strawberry
from core.auth import authenticate_user, create_access_token
from core.services import AnnotationService, UserService
from core.services.errors import ServiceError
from loguru import logger
from schemas.annotations import AnnotationCreate, AnnotationUpdate
from schemas.auth import UserCreate

from .types import (
    AnnotationCreateInput,
    AnnotationType,
    AnnotationUpdateInput,
    AuthResponse,
    UserCreateInput,
    UserType,
)


@strawberry.type
class Mutation:
    """GraphQL mutations."""

    @strawberry.mutation
    async def login(self, username: str, password: str) -> AuthResponse:
        """Login mutation."""
        try:
            user = await authenticate_user(username, password)
            if not user:
                raise ValueError("Invalid username or password")

            access_token = create_access_token(data={"sub": user.username})
            return AuthResponse(access_token=access_token)
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise ValueError("Login failed")

    @strawberry.mutation
    async def create_user(self, user_data: UserCreateInput) -> UserType:
        """Create user mutation."""
        try:
            service = UserService()
            user = await service.create_user(UserCreate(**user_data.__dict__))
            return UserType(
                id=str(user.id),
                username=user.username,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                is_active=user.is_active,
                is_admin=user.is_superuser,
            )
        except Exception as e:
            logger.error(f"Failed to create user: {e}")
            raise ValueError("Failed to create user")

    @strawberry.mutation
    async def update_user(self, user_id: int, user_data: UserCreateInput) -> UserType:
        """Update user mutation."""
        try:
            service = UserService()
            user = await service.update(
                user_id,
                username=user_data.username,
                email=user_data.email,
                first_name=user_data.first_name,
                last_name=user_data.last_name,
                is_active=user_data.is_active,
                is_superuser=user_data.is_admin,
            )
            if not user:
                raise ValueError(f"User not found: {user_id}")
            return UserType(
                id=str(user.id),
                username=user.username,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                is_active=user.is_active,
                is_admin=user.is_superuser,
            )
        except Exception as e:
            logger.error(f"Failed to update user: {e}")
            raise ValueError("Failed to update user")

    @strawberry.mutation
    async def delete_user(self, user_id: int) -> bool:
        """Delete user mutation."""
        try:
            service = UserService()
            return await service.delete(user_id)
        except Exception as e:
            logger.error(f"Failed to delete user: {e}")
            raise ValueError("Failed to delete user")

    @strawberry.mutation
    async def create_annotation(
        self, annotation_data: AnnotationCreateInput
    ) -> Optional[AnnotationType]:
        """Create a new annotation."""
        try:
            service = AnnotationService()
            result = await service.create(AnnotationCreate(**annotation_data.__dict__))
            if not result:
                return None
            return AnnotationType(
                id=result.id,
                user_id=result.user_id,
                file_path=result.file_path,
                start_time=result.start_time,
                end_time=result.end_time,
                text=result.text,
                created_at=result.created_at.isoformat(),
                updated_at=result.updated_at.isoformat(),
            )
        except ServiceError as e:
            logger.error(f"Failed to create annotation: {e}")
            return None

    @strawberry.mutation
    async def update_annotation(
        self, annotation_id: int, annotation_data: AnnotationUpdateInput
    ) -> Optional[AnnotationType]:
        """Update an existing annotation."""
        try:
            service = AnnotationService()
            result = await service.update(
                annotation_id,
                AnnotationUpdate(
                    **{
                        k: v
                        for k, v in annotation_data.__dict__.items()
                        if v is not None
                    }
                ),
            )
            if not result:
                return None
            return AnnotationType(
                id=result.id,
                user_id=result.user_id,
                file_path=result.file_path,
                start_time=result.start_time,
                end_time=result.end_time,
                text=result.text,
                created_at=result.created_at.isoformat(),
                updated_at=result.updated_at.isoformat(),
            )
        except ServiceError as e:
            logger.error(f"Failed to update annotation: {e}")
            return None

    @strawberry.mutation
    async def delete_annotation(self, annotation_id: int) -> bool:
        """Delete an annotation."""
        try:
            service = AnnotationService()
            await service.delete(annotation_id)
            return True
        except ServiceError as e:
            logger.error(f"Failed to delete annotation: {e}")
            return False
