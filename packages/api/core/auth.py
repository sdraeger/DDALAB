"""Authentication utilities."""

from datetime import datetime, timedelta, timezone
from typing import Optional

from core.config import get_server_settings
from core.dependencies import get_service
from core.models import User
from core.security import verify_password
from core.services import UserService
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

settings = get_server_settings()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")


async def authenticate_user(
    username: str,
    password: str,
    user_service: UserService = Depends(get_service(UserService)),
) -> Optional[User]:
    """Authenticate user using repository pattern

    Args:
        username (str): Username to authenticate
        password (str): Password to authenticate
        user_service (UserService, optional): UserService dependency

    Returns:
        Optional[User]: Authenticated user or None
    """
    user = await user_service.get_user(username=username)

    if not user or not verify_password(password, user.password_hash):
        logger.warning(f"Failed authentication attempt for user: {username}")
        return None

    logger.debug(f"User authenticated: {user.username}")
    return user


async def get_current_user(
    request: Request,
    user_service: UserService = Depends(get_service(UserService)),
) -> User:
    """Get current user using JWT token and repository

    Args:
        request (Request): Request object containing JWT token or local user
        user_service (UserService, optional): UserService dependency

    Returns:
        User: Authenticated user
    """
    # Check if we're in local mode and user is already injected by middleware
    if hasattr(request.state, "is_local_mode") and request.state.is_local_mode:
        if hasattr(request.state, "current_user") and request.state.current_user:
            logger.debug(
                f"Local mode: Using injected user '{request.state.current_user.username}'"
            )
            return request.state.current_user
        else:
            logger.error("Local mode detected but no user was injected by middleware")
            raise HTTPException(status_code=500, detail="Local mode user not available")

    # Multi-user mode - use JWT token authentication
    token = getattr(request.state, "token", None)

    if not token:
        logger.error("No token provided in request")
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        payload = jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        username = payload.get("sub")

        if not username:
            logger.error("Token missing 'sub' claim")
            raise HTTPException(status_code=401, detail="Invalid token format")

        if datetime.fromtimestamp(payload["exp"], tz=timezone.utc) < datetime.now(
            timezone.utc
        ):
            logger.warning(f"Expired token for user: {username}")
            raise HTTPException(status_code=401, detail="Token expired")

        user = await user_service.get_user(username=username)

        if not user:
            logger.error(f"User not found: {username}")
            raise HTTPException(status_code=404, detail="User not found")

        logger.debug(f"Authenticated user: {user.username}")
        return user

    except jwt.ExpiredSignatureError:
        logger.warning("Expired token signature")
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError as e:
        logger.error(f"JWT error: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


async def get_local_user(request: Request) -> User:
    """Get the local mode user from request state.

    Args:
        request: The incoming request

    Returns:
        User: The local mode user

    Raises:
        HTTPException: If not in local mode or user not available
    """
    if not settings.is_local_mode:
        raise HTTPException(
            status_code=400,
            detail="Local mode user only available in local authentication mode",
        )

    if not hasattr(request.state, "current_user") or not request.state.current_user:
        raise HTTPException(
            status_code=500, detail="Local mode user not available in request state"
        )

    return request.state.current_user


async def get_current_user_from_request(request: Request) -> User:
    """Get the current user from the request using JWT authentication.

    Args:
        request: The incoming request containing the JWT token

    Returns:
        User: The authenticated user

    Raises:
        HTTPException: For various authentication failures
    """
    # Handle local mode
    if hasattr(request.state, "is_local_mode") and request.state.is_local_mode:
        return await get_local_user(request)

    # Extract and validate token
    token = _extract_token_from_request(request)
    if not token:
        _log_auth_failure("No token provided")
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        payload = _decode_jwt_token(token)
        username = _validate_jwt_payload(payload)
        _check_token_expiration(payload)

        user = await _fetch_user_from_db(request.state.db, username)

        _log_successful_auth(user)
        return user

    except jwt.ExpiredSignatureError:
        _log_auth_failure("Token has expired")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.JWTError as e:
        _log_auth_failure(f"Invalid token: {str(e)}")
        raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise  # Re-raise already handled exceptions
    except Exception as e:
        _log_auth_failure(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Helper functions
def _extract_token_from_request(request: Request) -> str:
    """Extract and clean the JWT token from request headers.

    Args:
        request (Request): The incoming request containing the JWT token

    Returns:
        str: Cleaned JWT token
    """
    auth_header = request.headers.get("authorization", "")
    return auth_header.replace("Bearer ", "").strip()


def _decode_jwt_token(token: str) -> dict:
    """Decode and verify the JWT token.

    Args:
        token (str): JWT token to decode

    Returns:
        dict: Decoded JWT payload
    """
    return jwt.decode(
        token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
    )


def _validate_jwt_payload(payload: dict) -> str:
    """Validate JWT payload and extract username.

    Args:
        payload (dict): JWT payload

    Returns:
        str: Username extracted from the payload

    Raises:
        HTTPException: If 'sub' claim is missing
    """
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token: 'sub' not found")
    return username


def _check_token_expiration(payload: dict):
    """Verify token hasn't expired.

    Args:
        payload (dict): JWT payload

    Raises:
        HTTPException: If token has expired
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expires_at = datetime.fromtimestamp(payload.get("exp"), tz=timezone.utc).replace(
        tzinfo=None
    )

    if expires_at < now:
        raise HTTPException(status_code=401, detail="Token has expired")


async def _fetch_user_from_db(session: AsyncSession, username: str) -> User:
    """Fetch user from database.

    Args:
        session (AsyncSession): Database session
        username (str): Username to search for

    Returns:
        User: User object if found

    Raises:
        HTTPException: If user not found
    """
    user = await session.scalar(select(User).where(User.username == username))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _log_auth_failure(message: str):
    """Log authentication failure."""
    logger.warning(f"Authentication failed: {message}")


def _log_successful_auth(user: User):
    """Log successful authentication."""
    logger.debug(f"Successfully authenticated user: {user.username}")


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    """Create a JWT access token.

    Args:
        data (dict): Data to encode in the token
        expires_delta (Optional[timedelta]): Optional timedelta for token expiration

    Returns:
        str: JWT access token
    """

    to_encode = data.copy()

    expire = datetime.now(timezone.utc) + (
        expires_delta
        if expires_delta
        else timedelta(minutes=settings.token_expiration_minutes)
    )

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )
    return encoded_jwt


async def get_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Ensure the current user is an admin.

    Args:
        current_user (User): Current authenticated user

    Returns:
        User: Admin user

    Raises:
        HTTPException: If user is not an admin
    """

    if not current_user or not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )

    return current_user


def is_user_logged_in(request: Request) -> bool:
    """Check if the user is logged in."""
    # In local mode, always consider user as logged in since user is injected by middleware
    if hasattr(request.state, "is_local_mode") and request.state.is_local_mode:
        return (
            hasattr(request.state, "current_user")
            and request.state.current_user is not None
        )

    # In multi-user mode, check for token
    token = getattr(request.state, "token", None)
    return token is not None
