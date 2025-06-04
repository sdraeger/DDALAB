"""Integration tests for health API."""

import pytest
from fastapi import status
from httpx import AsyncClient


@pytest.mark.integration
class TestHealthAPI:
    """Test health check API endpoint."""

    @pytest.mark.asyncio
    async def test_health_check(self, async_client: AsyncClient):
        """Test health check endpoint returns OK."""
        response = await async_client.get("/api/health")

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert data == {"status": "ok"}

    @pytest.mark.asyncio
    async def test_health_check_no_auth_required(self, async_client: AsyncClient):
        """Test health check works without authentication."""
        # Health check should work without any authentication
        response = await async_client.get("/api/health")

        assert response.status_code == status.HTTP_200_OK
        assert "status" in response.json()

    @pytest.mark.asyncio
    async def test_health_check_method_not_allowed(self, async_client: AsyncClient):
        """Test health check with wrong HTTP method."""
        response = await async_client.post("/api/health")

        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

    @pytest.mark.asyncio
    async def test_health_check_response_format(self, async_client: AsyncClient):
        """Test health check response format."""
        response = await async_client.get("/api/health")

        assert response.status_code == status.HTTP_200_OK
        assert response.headers["content-type"] == "application/json"

        data = response.json()
        assert isinstance(data, dict)
        assert "status" in data
        assert data["status"] == "ok"
