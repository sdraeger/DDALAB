"""Authentication routes."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from server.core.auth import authenticate_user
from server.core.config import get_server_settings
from server.core.database import get_db
from server.schemas.auth import RefreshTokenRequest

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

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expires_at = now + timedelta(days=7)

        token = jwt.encode(
            {"sub": form_data.username, "exp": expires_at, "iat": now},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )

        refresh_payload = {
            "sub": form_data.username,
            "exp": now + timedelta(days=7),  # 7 days
            "iat": now,
        }
        refresh_token = jwt.encode(
            refresh_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
        )

        return {
            "access_token": token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
            },
        }


@router.post("/refresh-token")
async def refresh_token(
    refresh_token_request: RefreshTokenRequest,
):
    try:
        # Decode and verify refresh token
        payload = jwt.decode(
            refresh_token_request.refresh_token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        username = payload["sub"]

        now = datetime.now(timezone.utc).replace(tzinfo=None)

        # Generate new access token
        access_payload = {
            "sub": username,
            "exp": now + timedelta(days=7),
            "iat": now,
        }
        new_access_token = jwt.encode(
            access_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
        )

        return {
            "access_token": new_access_token,
            "expires_in": 7 * 24 * 60 * 60,  # TODO: Use env var
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
