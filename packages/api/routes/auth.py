"""Authentication routes."""

from datetime import timedelta

from core.auth import (
    authenticate_user,
)
from core.config import get_server_settings
from core.dependencies import get_service
from core.security import create_jwt_token, verify_refresh_token
from core.services import UserService
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from schemas.auth import RefreshTokenRequest

router = APIRouter()
settings = get_server_settings()


@router.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_service(UserService)),
):
    """Login endpoint to issue access tokens using repository pattern"""
    user = await authenticate_user(form_data.username, form_data.password, user_service)

    if not user:
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    # Update last login timestamp
    user = await user_service.update_last_login(user)

    expires_in = timedelta(days=7)  # TODO: use env var
    access_token = create_jwt_token(
        subject=user.username,
        expires_delta=expires_in,
        secret_key=settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    return {
        "access_token": access_token,
        "expires_in": expires_in.total_seconds(),
        "user": user,
    }


@router.post("/refresh-token")
async def refresh_token(
    refresh_token_request: RefreshTokenRequest,
    user_service: UserService = Depends(get_service(UserService)),
):
    """Refresh access token using valid refresh token"""
    try:
        payload = verify_refresh_token(refresh_token_request.refresh_token)

        user = await user_service.get_user(username=payload["sub"])
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Update last login timestamp on token refresh too
        user = await user_service.update_last_login(user)

        expires_in = timedelta(days=7)  # TODO: use env var
        new_access_token = create_jwt_token(
            subject=user.username,
            expires_delta=expires_in,
            secret_key=settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )

        return {
            "access_token": new_access_token,
            "expires_in": expires_in.total_seconds(),
            "user": user,
        }

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
