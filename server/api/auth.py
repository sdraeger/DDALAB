"""Authentication routes."""

from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from server.core.auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_current_user,
)
from server.core.config import get_server_settings
from server.core.database import User, get_db

router = APIRouter()
settings = get_server_settings()


class Token(BaseModel):
    """Token response model."""

    access_token: str
    token_type: str


class UserCreate(BaseModel):
    """User creation request model."""

    username: str
    password: str
    is_superuser: bool = False


@router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Login endpoint to get access token."""
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication is currently disabled",
        )

    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.jwt_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/users", response_model=Token)
async def create_new_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """Create a new user (requires superuser privileges, except for first superuser)."""
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication is currently disabled",
        )

    # Check if this is the first user being created
    existing_users = db.query(User).count()
    is_first_user = existing_users == 0
    print(f"Existing users: {existing_users}, Is first user: {is_first_user}")

    # Only allow creating the first user if they will be a superuser
    if is_first_user:
        if not user_data.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="First user must be a superuser",
            )
    else:
        # For subsequent users, require superuser privileges
        if not current_user or not current_user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to create users",
            )

    # Create the new user
    try:
        user = create_user(
            db,
            username=user_data.username,
            password=user_data.password,
            is_superuser=user_data.is_superuser,
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
