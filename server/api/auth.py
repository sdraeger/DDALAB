"""Authentication routes."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from server.core.auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_current_user,
)
from server.core.config import get_server_settings
from server.core.database import User, UserToken, get_db

router = APIRouter()
settings = get_server_settings()


class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    """User creation request model."""

    username: str
    password: str
    is_admin: bool = False


# @router.post("/token", response_model=Token)
# async def login_for_access_token(
#     form_data: OAuth2PasswordRequestForm = Depends(),
#     db: Session = Depends(get_db),
# ):
#     """Login endpoint to get access token."""
#     if not settings.auth_enabled:
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="Authentication is currently disabled",
#         )

#     user = authenticate_user(db, form_data.username, form_data.password)
#     if not user:
#         raise HTTPException(
#             status_code=status.HTTP_401_UNAUTHORIZED,
#             detail="Incorrect username or password",
#             headers={"WWW-Authenticate": "Bearer"},
#         )

#     access_token_expires = timedelta(minutes=settings.jwt_token_expire_minutes)
#     access_token = create_access_token(
#         data={"sub": user.username}, expires_delta=access_token_expires
#     )
#     return {"access_token": access_token, "token_type": "bearer"}


# @router.post("/token", response_model=Token)
# async def login_for_access_token(
#     form_data: OAuth2PasswordRequestForm = Depends(),
#     db: Session = Depends(get_db),
# ):
#     if not settings.auth_enabled:
#         raise HTTPException(
#             status_code=status.HTTP_403_FORBIDDEN,
#             detail="Authentication is disabled",
#         )

#     user = authenticate_user(db, form_data.username, form_data.password)
#     if not user:
#         raise HTTPException(
#             status_code=status.HTTP_401_UNAUTHORIZED,
#             detail="Incorrect username or password",
#             headers={"WWW-Authenticate": "Bearer"},
#         )

#     access_token = str(uuid.uuid4())
#     expires_at = datetime.now(timezone.utc) + timedelta(
#         minutes=settings.jwt_token_expire_minutes
#     )

#     user_token = UserToken(
#         token=access_token,
#         user_id=user.id,
#         expires_at=expires_at,
#         last_used_at=datetime.now(timezone.utc),
#     )
#     db.add(user_token)
#     logger.debug(f"Storing token: {access_token} for user_id: {user.id}")
#     db.commit()
#     logger.debug(f"Token committed: {access_token}")

#     return {"access_token": access_token, "token_type": "bearer"}


@router.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Login endpoint to issue access tokens."""
    user = await authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token = str(uuid.uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # Make naive
    expires_at = now + timedelta(minutes=30)

    user_token = UserToken(
        token=token,
        user_id=user.id,
        expires_at=expires_at,
        last_used_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(user_token)
    logger.debug(f"Storing token: {token} for user_id: {user.id}")
    await db.commit()
    logger.debug(f"Token committed: {token}")

    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 3600,  # 1 hour in seconds
    }


@router.post("/users", response_model=Token)
async def create_new_user(
    request: Request,
    user_data: UserCreate,
    db: Session = Depends(get_db),
):
    """Create a new user (requires admin privileges, except for first admin)."""
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication is currently disabled",
        )

    # Check if this is the first user being created
    existing_users = db.query(User).count()
    is_first_user = existing_users == 0
    print(f"Existing users: {existing_users}, Is first user: {is_first_user}")

    # Only allow creating the first user if they will be an admin
    if is_first_user:
        if not user_data.is_admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="First user must be an admin",
            )
    else:
        # For subsequent users, require admin privileges
        try:
            current_user = await get_current_user(request)
            if not current_user or not current_user.is_admin:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to create users",
                )
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Authentication required to create users",
            )

    # Create the new user
    try:
        user = create_user(
            db,
            username=user_data.username,
            password=user_data.password,
            is_admin=user_data.is_admin,
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
