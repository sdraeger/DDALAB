"""Integration tests for authentication API."""

import pytest
from fastapi import status
from httpx import AsyncClient


@pytest.mark.integration
@pytest.mark.auth
class TestAuthAPI:
    """Test authentication API endpoints."""

    @pytest.mark.asyncio
    async def test_login_success(self, async_client: AsyncClient, test_user):
        """Test successful login."""
        login_data = {
            "username": test_user.username,
            "password": "testpassword",
        }

        response = await async_client.post(
            "/api/auth/token",
            data=login_data,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert "access_token" in data
        assert "expires_in" in data
        assert "user" in data
        assert data["user"]["username"] == test_user.username

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(
        self, async_client: AsyncClient, test_user
    ):
        """Test login with invalid credentials."""
        login_data = {
            "username": test_user.username,
            "password": "wrongpassword",
        }

        response = await async_client.post(
            "/api/auth/token",
            data=login_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert "Incorrect username or password" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, async_client: AsyncClient):
        """Test login with nonexistent user."""
        login_data = {
            "username": "nonexistent",
            "password": "password",
        }

        response = await async_client.post(
            "/api/auth/token",
            data=login_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_login_missing_credentials(self, async_client: AsyncClient):
        """Test login with missing credentials."""
        # Missing password
        response = await async_client.post(
            "/api/auth/token",
            data={"username": "testuser"},
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.asyncio
    async def test_refresh_token_success(self, async_client: AsyncClient, test_user):
        """Test successful token refresh."""
        from datetime import timedelta

        from core.security import create_jwt_token

        # Create a refresh token
        refresh_token = create_jwt_token(
            subject=test_user.username,
            expires_delta=timedelta(days=7),
            secret_key="test_secret_key_123456789",
            algorithm="HS256",
        )

        response = await async_client.post(
            "/api/auth/refresh-token",
            json={"refresh_token": refresh_token},
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert "access_token" in data
        assert "expires_in" in data
        assert "user" in data
        assert data["user"]["username"] == test_user.username

    @pytest.mark.asyncio
    async def test_refresh_token_invalid(self, async_client: AsyncClient):
        """Test token refresh with invalid token."""
        response = await async_client.post(
            "/api/auth/refresh-token",
            json={"refresh_token": "invalid.token.here"},
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.asyncio
    async def test_refresh_token_expired(self, async_client: AsyncClient, test_user):
        """Test token refresh with expired token."""
        from datetime import timedelta

        from core.security import create_jwt_token

        # Create an expired token
        expired_token = create_jwt_token(
            subject=test_user.username,
            expires_delta=timedelta(seconds=-10),  # Expired 10 seconds ago
            secret_key="test_secret_key_123456789",
            algorithm="HS256",
        )

        response = await async_client.post(
            "/api/auth/refresh-token",
            json={"refresh_token": expired_token},
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_refresh_token_nonexistent_user(self, async_client: AsyncClient):
        """Test token refresh for nonexistent user."""
        from datetime import timedelta

        from core.security import create_jwt_token

        # Create a token for a user that doesn't exist
        refresh_token = create_jwt_token(
            subject="nonexistent_user",
            expires_delta=timedelta(days=7),
            secret_key="test_secret_key_123456789",
            algorithm="HS256",
        )

        response = await async_client.post(
            "/api/auth/refresh-token",
            json={"refresh_token": refresh_token},
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert "User not found" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_login_inactive_user(self, async_client: AsyncClient, test_session):
        """Test login with inactive user."""
        from core.database import User
        from core.security import get_password_hash

        # Create an inactive user
        inactive_user = User(
            username="inactive_user",
            email="inactive@example.com",
            password_hash=get_password_hash("password"),
            first_name="Inactive",
            last_name="User",
            is_active=False,
            is_admin=False,
        )
        test_session.add(inactive_user)
        await test_session.commit()

        login_data = {
            "username": "inactive_user",
            "password": "password",
        }

        response = await async_client.post(
            "/api/auth/token",
            data=login_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_auth_flow_integration(self, async_client: AsyncClient, test_user):
        """Test complete authentication flow."""
        # 1. Login
        login_data = {
            "username": test_user.username,
            "password": "testpassword",
        }

        login_response = await async_client.post(
            "/api/auth/token",
            data=login_data,
        )

        assert login_response.status_code == status.HTTP_200_OK
        login_data = login_response.json()
        access_token = login_data["access_token"]

        # 2. Use the access token to access a protected endpoint
        headers = {"Authorization": f"Bearer {access_token}"}

        protected_response = await async_client.get(
            "/api/users",
            headers=headers,
        )

        # This should work if the token is valid and user has permission
        assert protected_response.status_code in [
            status.HTTP_200_OK,
            status.HTTP_403_FORBIDDEN,  # User might not have admin permissions
        ]
