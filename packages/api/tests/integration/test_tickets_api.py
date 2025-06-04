"""Integration tests for tickets API."""

import pytest
from fastapi import status
from httpx import AsyncClient


@pytest.mark.integration
class TestTicketsAPI:
    """Test tickets API endpoints."""

    @pytest.mark.asyncio
    async def test_create_ticket(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test creating a ticket."""
        ticket_data = test_data_factory.ticket_data(
            title="Test Ticket", description="This is a test ticket", status="open"
        )

        response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert response.status_code == status.HTTP_201_CREATED

        data = response.json()
        assert data["title"] == ticket_data["title"]
        assert data["description"] == ticket_data["description"]
        assert data["status"] == ticket_data["status"]

    @pytest.mark.asyncio
    async def test_create_ticket_unauthorized(
        self, async_client: AsyncClient, test_data_factory
    ):
        """Test creating a ticket without authentication."""
        ticket_data = test_data_factory.ticket_data()

        response = await async_client.post(
            "/api/tickets",
            json=ticket_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_create_ticket_invalid_data(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test creating a ticket with invalid data."""
        invalid_ticket_data = {
            "title": "",  # Empty title
            "description": "",  # Empty description
        }

        response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=invalid_ticket_data,
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.asyncio
    async def test_get_tickets(self, async_client: AsyncClient, auth_headers_user):
        """Test getting tickets for a user."""
        response = await async_client.get(
            "/api/tickets",
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_get_tickets_unauthorized(self, async_client: AsyncClient):
        """Test getting tickets without authentication."""
        response = await async_client.get("/api/tickets")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_get_ticket_by_id(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test getting a specific ticket by ID."""
        # First create a ticket
        ticket_data = test_data_factory.ticket_data()

        create_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_ticket = create_response.json()

        # Now get the ticket by ID
        get_response = await async_client.get(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert get_response.status_code == status.HTTP_200_OK

        data = get_response.json()
        assert data["id"] == created_ticket["id"]
        assert data["title"] == ticket_data["title"]

    @pytest.mark.asyncio
    async def test_get_ticket_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test getting a nonexistent ticket."""
        response = await async_client.get(
            "/api/tickets/99999",  # Non-existent ID
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_ticket(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test updating a ticket."""
        # First create a ticket
        ticket_data = test_data_factory.ticket_data()

        create_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_ticket = create_response.json()

        # Update the ticket
        update_data = {
            "status": "closed",
            "description": "Updated description",
        }

        update_response = await async_client.put(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert update_response.status_code == status.HTTP_200_OK

        data = update_response.json()
        assert data["status"] == "closed"
        assert data["description"] == "Updated description"
        assert data["title"] == ticket_data["title"]  # Unchanged

    @pytest.mark.asyncio
    async def test_update_ticket_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test updating a nonexistent ticket."""
        update_data = {
            "status": "closed",
        }

        response = await async_client.put(
            "/api/tickets/99999",  # Non-existent ID
            headers=auth_headers_user,
            json=update_data,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_ticket_unauthorized(
        self, async_client: AsyncClient, test_data_factory
    ):
        """Test updating a ticket without authentication."""
        update_data = {
            "status": "closed",
        }

        response = await async_client.put(
            "/api/tickets/1",
            json=update_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_delete_ticket(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test deleting a ticket."""
        # First create a ticket
        ticket_data = test_data_factory.ticket_data()

        create_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_ticket = create_response.json()

        # Delete the ticket
        delete_response = await async_client.delete(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert delete_response.status_code == status.HTTP_200_OK

        # Verify the ticket is deleted
        get_response = await async_client.get(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert get_response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_ticket_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test deleting a nonexistent ticket."""
        response = await async_client.delete(
            "/api/tickets/99999",  # Non-existent ID
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_ticket_unauthorized(self, async_client: AsyncClient):
        """Test deleting a ticket without authentication."""
        response = await async_client.delete("/api/tickets/1")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_ticket_crud_flow(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test complete ticket CRUD flow."""
        # 1. Create ticket
        ticket_data = test_data_factory.ticket_data(
            title="CRUD Test Ticket",
            description="Testing CRUD operations",
            status="open",
        )

        create_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_ticket = create_response.json()

        # 2. Read ticket
        read_response = await async_client.get(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert read_response.status_code == status.HTTP_200_OK
        read_ticket = read_response.json()
        assert read_ticket["title"] == ticket_data["title"]

        # 3. Update ticket
        update_data = {
            "status": "in_progress",
            "description": "Updated during CRUD test",
        }

        update_response = await async_client.put(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert update_response.status_code == status.HTTP_200_OK
        updated_ticket = update_response.json()
        assert updated_ticket["status"] == "in_progress"
        assert updated_ticket["description"] == "Updated during CRUD test"

        # 4. Delete ticket
        delete_response = await async_client.delete(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert delete_response.status_code == status.HTTP_200_OK

        # 5. Verify deletion
        final_read_response = await async_client.get(
            f"/api/tickets/{created_ticket['id']}",
            headers=auth_headers_user,
        )

        assert final_read_response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_user_can_only_access_own_tickets(
        self,
        async_client: AsyncClient,
        auth_headers_user,
        auth_headers_admin,
        test_data_factory,
    ):
        """Test that users can only access their own tickets."""
        # Create a ticket as regular user
        ticket_data = test_data_factory.ticket_data(title="User Ticket")

        user_ticket_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_user,
            json=ticket_data,
        )

        assert user_ticket_response.status_code == status.HTTP_201_CREATED
        user_ticket = user_ticket_response.json()

        # Create a ticket as admin
        admin_ticket_response = await async_client.post(
            "/api/tickets",
            headers=auth_headers_admin,
            json=test_data_factory.ticket_data(title="Admin Ticket"),
        )

        assert admin_ticket_response.status_code == status.HTTP_201_CREATED
        admin_ticket = admin_ticket_response.json()

        # User should be able to access their own ticket
        user_access_response = await async_client.get(
            f"/api/tickets/{user_ticket['id']}",
            headers=auth_headers_user,
        )

        assert user_access_response.status_code == status.HTTP_200_OK

        # User should NOT be able to access admin's ticket (if proper isolation is implemented)
        # Note: This depends on the actual implementation of authorization
        admin_access_response = await async_client.get(
            f"/api/tickets/{admin_ticket['id']}",
            headers=auth_headers_user,
        )

        # This could be 403 Forbidden or 404 Not Found depending on implementation
        assert admin_access_response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        ]
