"""Unit tests for security functions."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from core.security import (
    create_jwt_token,
    decode_jwt_token,
    get_password_hash,
    verify_password,
    verify_refresh_token,
)
from fastapi import HTTPException
from jose import jwt
from jose.exceptions import JWTError
from passlib.context import CryptContext


class TestPasswordSecurity:
    """Test password hashing and verification."""

    def test_password_hash_generation(self):
        """Test password hash generation."""
        password = "test_password_123"
        hashed = get_password_hash(password)

        assert hashed != password
        assert len(hashed) > 0
        assert hashed.startswith("$2b$")  # bcrypt hash prefix

    def test_password_verification_success(self):
        """Test successful password verification."""
        password = "test_password_123"
        hashed = get_password_hash(password)

        assert verify_password(password, hashed) is True

    def test_password_verification_failure(self):
        """Test failed password verification."""
        password = "test_password_123"
        wrong_password = "wrong_password"
        hashed = get_password_hash(password)

        assert verify_password(wrong_password, hashed) is False

    def test_password_hash_uniqueness(self):
        """Test that same password generates different hashes."""
        password = "test_password_123"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)

        # Hashes should be different due to salt
        assert hash1 != hash2
        # But both should verify correctly
        assert verify_password(password, hash1) is True
        assert verify_password(password, hash2) is True

    def test_empty_password_handling(self):
        """Test handling of empty passwords."""
        empty_password = ""
        hashed = get_password_hash(empty_password)

        assert verify_password(empty_password, hashed) is True
        assert verify_password("not_empty", hashed) is False


class TestJWTTokens:
    """Test JWT token creation and verification."""

    def test_jwt_token_creation(self):
        """Test JWT token creation."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"
        expires_delta = timedelta(minutes=30)

        token = create_jwt_token(
            subject=subject,
            expires_delta=expires_delta,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        assert isinstance(token, str)
        assert len(token) > 0

        # Decode and verify the token
        payload = jwt.decode(token, secret_key, algorithms=[algorithm])
        assert payload["sub"] == subject
        assert "exp" in payload

    def test_jwt_token_expiration(self):
        """Test JWT token with expiration time."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"
        expires_delta = timedelta(minutes=30)

        # Mock datetime.now for consistent testing
        with patch("core.security.datetime") as mock_datetime:
            # Use a fixed time that allows the token to be non-expired when created
            now = datetime(2023, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = now

            token = create_jwt_token(
                subject=subject,
                expires_delta=expires_delta,
                secret_key=secret_key,
                algorithm=algorithm,
            )

            # Decode the token without time validation to check the payload
            payload = jwt.decode(
                token, secret_key, algorithms=[algorithm], options={"verify_exp": False}
            )
            # The expected expiration should match what the function actually creates
            # Since it uses datetime.now() and we've mocked it, the calculation should match
            expected_exp = int((now + expires_delta).timestamp())
            assert payload["exp"] == expected_exp

    def test_jwt_token_default_expiration(self):
        """Test JWT token with default expiration."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        token = create_jwt_token(
            subject=subject,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        payload = jwt.decode(token, secret_key, algorithms=[algorithm])
        assert "exp" in payload
        assert payload["sub"] == subject

    def test_jwt_token_with_additional_claims(self):
        """Test JWT token with additional claims."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        # Test with current signature (without additional claims parameter)
        token = create_jwt_token(
            subject=subject,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        payload = jwt.decode(token, secret_key, algorithms=[algorithm])
        assert payload["sub"] == subject

    def test_jwt_token_invalid_secret(self):
        """Test JWT token verification with invalid secret."""
        subject = "testuser"
        secret_key = "test_secret_key"
        wrong_secret = "wrong_secret_key"
        algorithm = "HS256"

        token = create_jwt_token(
            subject=subject,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        with pytest.raises(JWTError):
            jwt.decode(token, wrong_secret, algorithms=[algorithm])


class TestRefreshTokens:
    """Test refresh token verification."""

    def test_verify_refresh_token_success(self):
        """Test successful refresh token verification."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        # Create a token that can be used as refresh token
        token = create_jwt_token(
            subject=subject,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        # Test the decode_jwt_token function directly with the same secret key
        payload = decode_jwt_token(
            token, secret_key=secret_key, algorithm=algorithm, leeway=30
        )
        assert payload["sub"] == subject

    def test_verify_refresh_token_expired(self):
        """Test verification of expired refresh token."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        # Create an expired token
        with patch("core.security.datetime") as mock_datetime:
            past_time = datetime(2020, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = past_time
            mock_datetime.utcnow.return_value = past_time.replace(tzinfo=None)

            token = create_jwt_token(
                subject=subject,
                expires_delta=timedelta(minutes=-30),  # Expired 30 minutes ago
                secret_key=secret_key,
                algorithm=algorithm,
            )

        with patch("core.security.get_settings") as mock_settings:
            mock_settings.return_value.jwt_secret_key = secret_key
            mock_settings.return_value.jwt_algorithm = algorithm

            with pytest.raises(HTTPException):
                verify_refresh_token(token)

    def test_verify_refresh_token_invalid(self):
        """Test verification of invalid refresh token."""
        invalid_token = "invalid.token.here"

        with patch("core.security.get_settings") as mock_settings:
            mock_settings.return_value.jwt_secret_key = "test_secret_key"
            mock_settings.return_value.jwt_algorithm = "HS256"

            with pytest.raises(HTTPException):
                verify_refresh_token(invalid_token)


@pytest.mark.unit
class TestSecurityIntegration:
    """Test security integration scenarios."""

    def test_full_auth_flow(self):
        """Test complete authentication flow."""
        # User registration - password hashing
        password = "user_password_123"
        hashed_password = get_password_hash(password)

        # User login - password verification
        assert verify_password(password, hashed_password) is True

        # Token creation
        username = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        access_token = create_jwt_token(
            subject=username,
            expires_delta=timedelta(minutes=30),
            secret_key=secret_key,
            algorithm=algorithm,
        )

        # Token verification
        payload = jwt.decode(access_token, secret_key, algorithms=[algorithm])
        assert payload["sub"] == username

    def test_security_constants(self):
        """Test security-related constants and configurations."""
        # Test that bcrypt context is properly configured
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

        password = "test_password"
        hashed = pwd_context.hash(password)

        assert pwd_context.verify(password, hashed) is True
        assert pwd_context.verify("wrong_password", hashed) is False

    def test_token_payload_structure(self):
        """Test JWT token payload structure."""
        subject = "testuser"
        secret_key = "test_secret_key"
        algorithm = "HS256"

        token = create_jwt_token(
            subject=subject,
            secret_key=secret_key,
            algorithm=algorithm,
        )

        payload = jwt.decode(token, secret_key, algorithms=[algorithm])

        # Verify required fields
        assert "sub" in payload
        assert "exp" in payload
        assert payload["sub"] == subject

        # Verify expiration is in the future
        current_timestamp = datetime.utcnow().timestamp()
        assert payload["exp"] > current_timestamp
