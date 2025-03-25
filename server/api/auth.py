"""Authentication routes."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from server.core.auth import authenticate_user
from server.core.config import get_server_settings
from server.core.database import UserToken, get_db

router = APIRouter()
settings = get_server_settings()


@router.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Login endpoint to issue access tokens."""

    async with db.begin():
        user = await authenticate_user(db, form_data.username, form_data.password)
        if not user:
            raise HTTPException(
                status_code=401, detail="Incorrect username or password"
            )

        token = str(uuid.uuid4())
        now = datetime.now(timezone.utc).replace(tzinfo=None)
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
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
            },
        }
