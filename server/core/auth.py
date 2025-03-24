"""Authentication utilities and configuration."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from loguru import logger
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from server.core.database import User, UserToken, get_db

# Password hashing configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# OAuth2 configuration with password flow
# oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# JWT configuration
SECRET_KEY = "ddalab-auth-secret-key-2024-03-21-development"
ALGORITHM = "HS256"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generate password hash."""
    return pwd_context.hash(password)


async def authenticate_user(
    db: AsyncSession, username: str, password: str
) -> User | None:
    """Authenticate a user with username and password."""

    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(password, user.password_hash):
        return None

    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create a JWT access token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user_from_request(
    request: Request, session: AsyncSession
) -> User:
    logger.debug(f"request.headers: {request.headers}")
    token = request.headers.get("authorization", "").replace("Bearer ", "")
    logger.debug(f"authorization: {request.headers.get('authorization')}")
    logger.debug(f"token: {token}")

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    user_token = await session.scalar(select(UserToken).where(UserToken.token == token))
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if not user_token or user_token.expires_at < now:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = await session.get(User, user_token.user_id)

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    logger.debug(f"user_token: {user_token}")
    return user


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    async with db.begin():
        if not token:
            raise HTTPException(status_code=401, detail="Authentication required")

        user_token = await db.scalar(select(UserToken).where(UserToken.token == token))
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if not user_token or user_token.expires_at < now:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

        user = await db.get(User, user_token.user_id)
        logger.debug(f"user: {user}")

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        return user


async def create_user(
    db: AsyncSession, username: str, password: str, is_admin: bool = False
) -> User:
    """Create a new user."""
    hashed_password = get_password_hash(
        password
    )  # Assuming this is sync; if async, await it
    user = User(
        username=username,
        password_hash=hashed_password,
        is_admin=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_user(db: AsyncSession, user_id: int):
    """Delete a user."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if user:
        await db.delete(user)
        await db.commit()
