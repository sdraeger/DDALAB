from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTError
from passlib.context import CryptContext

from .environment import get_config_service

auth_settings = get_config_service().get_auth_settings()

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hashed version."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Generate a password hash."""
    return pwd_context.hash(password)


def create_jwt_token(
    subject: str,
    expires_delta: Optional[timedelta] = None,
    secret_key: str = auth_settings.jwt_secret_key,
    algorithm: str = auth_settings.jwt_algorithm,
    **extra_claims,
) -> str:
    """
    Create a JWT token with specified claims.

    Args:
        subject: The subject of the token (typically user identifier)
        expires_delta: Optional timedelta for token expiration
        secret_key: Secret key for signing
        algorithm: Encryption algorithm
        extra_claims: Additional claims to include in the token

    Returns:
        Encoded JWT token string
    """
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=7)  # Default expiration

    payload = {"sub": subject, "iat": now, "exp": expire, **extra_claims}

    return jwt.encode(payload, secret_key, algorithm=algorithm)


def decode_jwt_token(
    token: str,
    secret_key: str = auth_settings.jwt_secret_key,
    algorithm: str = auth_settings.jwt_algorithm,
    leeway: int = 0,
) -> dict:
    """
    Decode and verify a JWT token.

    Args:
        token: JWT token to decode
        secret_key: Secret key used for verification
        algorithm: Encryption algorithm
        leeway: Time leeway in seconds for expiration verification

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(
            token, secret_key, algorithms=[algorithm], options={"leeway": leeway}
        )
        return payload
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def verify_refresh_token(token: str) -> dict:
    """
    Verify a refresh token with extended expiration.

    Args:
        token: Refresh token to verify

    Returns:
        Decoded token payload

    Raises:
        HTTPException: If token is invalid
    """
    return decode_jwt_token(token, leeway=30)  # 30 seconds leeway for clock skew


def generate_token_pair(username: str) -> dict:
    """
    Generate both access and refresh tokens.

    Args:
        username: Subject for the tokens

    Returns:
        Dictionary with access_token and refresh_token
    """
    return {
        "access_token": create_jwt_token(
            username,
            expires_delta=timedelta(minutes=auth_settings.token_expiration_minutes),
        ),
        "refresh_token": create_jwt_token(
            username,
            expires_delta=timedelta(days=auth_settings.refresh_token_expire_days),
        ),
    }
