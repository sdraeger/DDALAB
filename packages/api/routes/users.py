"""User management routes."""

from datetime import timedelta

from core.auth import (
    create_access_token,
    get_admin_user,
    get_current_user,
)
from core.config import get_server_settings
from core.database import User as UserDB
from core.dependencies import get_service
from core.services import UserService
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from schemas.auth import Token
from schemas.user import User, UserCreate, UserUpdate

router = APIRouter()
settings = get_server_settings()


@router.post("", response_model=Token)
async def create_user(
    user_data: UserCreate,
    user_service: UserService = Depends(get_service(UserService)),
    _: UserDB = Depends(get_current_user),
):
    """Create a new user (requires admin privileges)."""

    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication is currently disabled",
        )

    # Create the new user
    try:
        user = await user_service.create_user(user_data)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create user: {str(e)}",
        )

    # Generate and return access token for the new user
    access_token_expires = timedelta(minutes=settings.token_expiration_minutes)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("", response_model=list[User])
async def get_users(
    user_service: UserService = Depends(get_service(UserService)),
    _: UserDB = Depends(get_current_user),
):
    """Get all users (requires admin privileges)."""

    users = await user_service.get_all_users()
    logger.debug(f"Users: {users}")
    return users


@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    user_service: UserService = Depends(get_service(UserService)),
    _: UserDB = Depends(get_admin_user),
):
    """Update a user (requires admin privileges)."""

    user = await user_service.update(user_id, user_data)
    return user


@router.delete("/{user_id}", response_model=User)
async def delete_user(
    user_id: int,
    user_service: UserService = Depends(get_service(UserService)),
    _: UserDB = Depends(get_admin_user),
):
    """Delete a user (requires admin privileges)."""

    user = await user_service.delete(user_id)
    return user
