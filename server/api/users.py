"""User management routes."""

from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from server.core.auth import (
    Token,
    UserCreate,
    UserUpdate,
    create_access_token,
    get_admin_user,
)
from server.core.auth import (
    create_user as create_user_core,
    get_users as get_users_core,
    update_user as update_user_core,
    delete_user as delete_user_core,
)
from server.core.config import get_server_settings
from server.core.database import User as UserDB, get_db
from server.schemas.user import User

router = APIRouter()
settings = get_server_settings()


@router.post("", response_model=Token)
async def create_user(
    user_data: UserCreate,
    _: UserDB = Depends(get_admin_user, use_cache=False),
    db: Session = Depends(get_db),
):
    """Create a new user (requires admin privileges)."""

    async with db.begin():
        if not settings.auth_enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authentication is currently disabled",
            )

        # Create the new user
        try:
            user = await create_user_core(
                db,
                user_data,
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not create user: {str(e)}",
            )

        # Generate and return access token for the new user
        access_token_expires = timedelta(minutes=settings.jwt_token_expire_minutes)
        access_token = create_access_token(
            data={"sub": user.username}, expires_delta=access_token_expires
        )
        return {"access_token": access_token, "token_type": "bearer"}


@router.get("/", response_model=list[User])
async def get_users(
    _: UserDB = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Get all users (requires admin privileges)."""

    async with db.begin():
        users = await get_users_core(db)
        return users


@router.put("/{user_id}", response_model=User)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    _: UserDB = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Update a user (requires admin privileges)."""

    async with db.begin():
        user = await update_user_core(db, user_id, user_data)
        return user


@router.delete("/{user_id}", response_model=User)
async def delete_user(
    user_id: int,
    _: UserDB = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    """Delete a user (requires admin privileges)."""

    async with db.begin():
        user = await delete_user_core(db, user_id)
        return user
