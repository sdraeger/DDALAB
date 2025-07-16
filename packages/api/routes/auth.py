"""Authentication routes."""

from datetime import timedelta

from core.auth import (
    authenticate_user,
)
from core.config import get_server_settings
from core.dependencies import get_service
from core.security import create_jwt_token, verify_refresh_token
from core.services import UserService
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from schemas.auth import RefreshTokenRequest

router = APIRouter()
settings = get_server_settings()


@router.get("/mode")
async def get_auth_mode(request: Request):
    """Get the current authentication mode and user information.

    Returns:
        dict: Authentication mode information including current user if in local mode
    """
    auth_info = {
        "auth_mode": settings.auth_mode,
        "auth_enabled": settings.auth_enabled,
        "is_local_mode": settings.is_local_mode,
    }

    # If in local mode, include the current user information
    if settings.is_local_mode:
        try:
            from core.services.local_user_service import LocalUserService

            # Use the database session from middleware
            local_user_service = LocalUserService(request.state.db)
            default_user = await local_user_service.get_default_user()

            auth_info["current_user"] = {
                "id": default_user.id,
                "username": default_user.username,
                "email": default_user.email,
                "first_name": default_user.first_name,
                "last_name": default_user.last_name,
                "is_active": default_user.is_active,
                "is_admin": default_user.is_admin,
            }
        except Exception as e:
            # Log error but don't fail the request
            from loguru import logger

            logger.error(f"Failed to get local mode user: {e}")
            auth_info["error"] = "Failed to get local mode user"

    return auth_info


@router.post("/token")
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_service(UserService)),
):
    """Login endpoint to issue access tokens using repository pattern"""
    # In local mode, reject login attempts
    if settings.is_local_mode:
        raise HTTPException(
            status_code=400, detail="Authentication is disabled in local mode"
        )

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
    # In local mode, reject refresh token attempts
    if settings.is_local_mode:
        raise HTTPException(
            status_code=400, detail="Token refresh is disabled in local mode"
        )

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
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
