"""User management routes."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from ..core.auth import (
    create_access_token,
    get_admin_user,
)
from ..core.config import get_server_settings
from ..core.database import User as UserDB
from ..core.repository import UserRepository, get_repository
from ..schemas.auth import Token
from ..schemas.user import User, UserCreate, UserUpdate

router = APIRouter()
settings = get_server_settings()


@router.post("", response_model=Token)
async def create_user(
    user_data: UserCreate,
    _: UserDB = Depends(get_admin_user, use_cache=False),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
):
    """Create a new user (requires admin privileges)."""

    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication is currently disabled",
        )

    # Create the new user
    try:
        user = await user_repo.create(user_data)
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


@router.get("/", response_model=list[User])
async def get_users(
    _: UserDB = Depends(get_admin_user),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
):
    """Get all users (requires admin privileges)."""

    users = await user_repo.get_all()
    return users


@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    _: UserDB = Depends(get_admin_user),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
):
    """Update a user (requires admin privileges)."""

    user = await user_repo.update(user_id, user_data)
    return user


@router.delete("/{user_id}", response_model=User)
async def delete_user(
    user_id: int,
    _: UserDB = Depends(get_admin_user),
    user_repo: UserRepository = Depends(get_repository(UserRepository)),
):
    """Delete a user (requires admin privileges)."""

    user = await user_repo.delete(user_id)
    return user
