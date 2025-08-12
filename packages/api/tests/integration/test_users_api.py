"""Integration tests for users API."""

import pytest
from fastapi import status
from httpx import AsyncClient


@pytest.mark.integration
class TestUsersAPI:
    """Test users API endpoints."""

    @pytest.mark.asyncio
    async def test_get_users_as_admin(
        self, async_client: AsyncClient, auth_headers_admin
    ):
        """Test getting users as admin."""
        response = await async_client.get(
            "/api/users",
            headers=auth_headers_admin,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert isinstance(data, list)
        # Should have at least the admin user
        assert len(data) >= 1

    @pytest.mark.asyncio
    async def test_get_users_as_regular_user(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test getting users as regular user (should be allowed but might be restricted)."""
        response = await async_client.get(
            "/api/users",
            headers=auth_headers_user,
        )

        # Regular users should still be able to see users list
        assert response.status_code == status.HTTP_200_OK

    @pytest.mark.asyncio
    async def test_get_users_unauthorized(self, async_client: AsyncClient):
        """Test getting users without authentication."""
        response = await async_client.get("/api/users")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_create_user_as_admin(
        self, async_client: AsyncClient, auth_headers_admin, test_data_factory
    ):
        """Test creating a user as admin."""
        user_data = test_data_factory.user_data(
            username="newuser",
            email="newuser@example.com",
        )

        response = await async_client.post(
            "/api/users",
            headers=auth_headers_admin,
            json=user_data,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert "access_token" in data
        assert "token_type" in data

    @pytest.mark.asyncio
    async def test_create_user_duplicate_username(
        self, async_client: AsyncClient, auth_headers_admin, test_user
    ):
        """Test creating a user with duplicate username."""
        user_data = {
            "username": test_user.username,  # Duplicate username
            "email": "different@example.com",
            "password": "newpassword",
            "first_name": "New",
            "last_name": "User",
        }

        response = await async_client.post(
            "/api/users",
            headers=auth_headers_admin,
            json=user_data,
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Could not create user" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_user_duplicate_email(
        self, async_client: AsyncClient, auth_headers_admin, test_user
    ):
        """Test creating a user with duplicate email."""
        user_data = {
            "username": "newuser",
            "email": test_user.email,  # Duplicate email
            "password": "newpassword",
            "first_name": "New",
            "last_name": "User",
        }

        response = await async_client.post(
            "/api/users",
            headers=auth_headers_admin,
            json=user_data,
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.asyncio
    async def test_create_user_invalid_data(
        self, async_client: AsyncClient, auth_headers_admin
    ):
        """Test creating a user with invalid data."""
        invalid_user_data = {
            "username": "",  # Empty username
            "email": "invalid-email",  # Invalid email format
        }

        response = await async_client.post(
            "/api/users",
            headers=auth_headers_admin,
            json=invalid_user_data,
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.asyncio
    async def test_create_user_unauthorized(
        self, async_client: AsyncClient, test_data_factory
    ):
        """Test creating a user without authentication."""
        user_data = test_data_factory.user_data()

        response = await async_client.post(
            "/api/users",
            json=user_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_update_user_as_admin(
        self, async_client: AsyncClient, auth_headers_admin, test_user
    ):
        """Test updating a user as admin."""
        update_data = {
            "first_name": "Updated",
            "last_name": "Name",
        }

        response = await async_client.put(
            f"/api/users/{test_user.id}",
            headers=auth_headers_admin,
            json=update_data,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data["first_name"] == "Updated"
        assert data["last_name"] == "Name"
        assert data["username"] == test_user.username  # Unchanged

    @pytest.mark.asyncio
    async def test_update_user_not_found(
        self, async_client: AsyncClient, auth_headers_admin
    ):
        """Test updating a nonexistent user."""
        update_data = {
            "first_name": "Updated",
        }

        response = await async_client.put(
            "/api/users/99999",  # Non-existent ID
            headers=auth_headers_admin,
            json=update_data,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_user_unauthorized(self, async_client: AsyncClient, test_user):
        """Test updating a user without authentication."""
        update_data = {
            "first_name": "Updated",
        }

        response = await async_client.put(
            f"/api/users/{test_user.id}",
            json=update_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_update_user_as_regular_user(
        self, async_client: AsyncClient, auth_headers_user, test_user
    ):
        """Test updating a user as regular user (should require admin)."""
        update_data = {
            "first_name": "Updated",
        }

        response = await async_client.put(
            f"/api/users/{test_user.id}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_delete_user_as_admin(
        self, async_client: AsyncClient, auth_headers_admin, test_session
    ):
        """Test deleting a user as admin."""
        from core.models import User
        from core.security import get_password_hash

        # Create a user to delete
        user_to_delete = User(
            username="to_delete",
            email="delete@example.com",
            password_hash=get_password_hash("password"),
            first_name="To",
            last_name="Delete",
            is_active=True,
            is_admin=False,
        )
        test_session.add(user_to_delete)
        await test_session.commit()
        await test_session.refresh(user_to_delete)

        response = await async_client.delete(
            f"/api/users/{user_to_delete.id}",
            headers=auth_headers_admin,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data["username"] == "to_delete"

    @pytest.mark.asyncio
    async def test_delete_user_not_found(
        self, async_client: AsyncClient, auth_headers_admin
    ):
        """Test deleting a nonexistent user."""
        response = await async_client.delete(
            "/api/users/99999",  # Non-existent ID
            headers=auth_headers_admin,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_user_unauthorized(self, async_client: AsyncClient, test_user):
        """Test deleting a user without authentication."""
        response = await async_client.delete(f"/api/users/{test_user.id}")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_delete_user_as_regular_user(
        self, async_client: AsyncClient, auth_headers_user, test_user
    ):
        """Test deleting a user as regular user (should require admin)."""
        response = await async_client.delete(
            f"/api/users/{test_user.id}",
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.asyncio
    async def test_user_crud_flow(
        self, async_client: AsyncClient, auth_headers_admin, test_data_factory
    ):
        """Test complete user CRUD flow."""
        # 1. Create user
        user_data = test_data_factory.user_data(
            username="cruduser",
            email="crud@example.com",
        )

        create_response = await async_client.post(
            "/api/users",
            headers=auth_headers_admin,
            json=user_data,
        )

        assert create_response.status_code == status.HTTP_200_OK

        # 2. Get all users and verify the new user is in the list
        list_response = await async_client.get(
            "/api/users",
            headers=auth_headers_admin,
        )

        assert list_response.status_code == status.HTTP_200_OK
        users = list_response.json()
        created_user = next((u for u in users if u["username"] == "cruduser"), None)
        assert created_user is not None

        # 3. Update user
        update_data = {
            "first_name": "Updated",
            "last_name": "CRUD",
        }

        update_response = await async_client.put(
            f"/api/users/{created_user['id']}",
            headers=auth_headers_admin,
            json=update_data,
        )

        assert update_response.status_code == status.HTTP_200_OK
        updated_user = update_response.json()
        assert updated_user["first_name"] == "Updated"
        assert updated_user["last_name"] == "CRUD"

        # 4. Delete user
        delete_response = await async_client.delete(
            f"/api/users/{created_user['id']}",
            headers=auth_headers_admin,
        )

        assert delete_response.status_code == status.HTTP_200_OK
