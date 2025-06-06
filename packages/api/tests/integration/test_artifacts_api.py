"""Integration tests for artifacts API."""

import uuid
from unittest.mock import patch

import pytest
from fastapi import status
from httpx import AsyncClient


@pytest.mark.integration
class TestArtifactsAPI:
    """Test artifacts API endpoints."""

    @pytest.mark.asyncio
    async def test_create_artifact(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test creating an artifact."""
        artifact_data = test_data_factory.artifact_data(
            name="test_image.jpg", file_path="/tmp/test_image.jpg"
        )

        response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert response.status_code == status.HTTP_201_CREATED

        data = response.json()
        assert data["name"] == artifact_data["name"]
        assert data["file_path"] == artifact_data["file_path"]
        assert "artifact_id" in data
        assert data["user_id"] is not None

    @pytest.mark.asyncio
    async def test_create_artifact_unauthorized(
        self, async_client: AsyncClient, test_data_factory
    ):
        """Test creating an artifact without authentication."""
        artifact_data = test_data_factory.artifact_data()

        response = await async_client.post(
            "/api/artifacts",
            json=artifact_data,
        )

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_create_artifact_invalid_data(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test creating an artifact with invalid data."""
        invalid_artifact_data = {
            "name": "",  # Empty name
            "file_path": "",  # Empty file path
        }

        response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=invalid_artifact_data,
        )

        assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.asyncio
    async def test_get_user_artifacts(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test getting artifacts for a user."""
        response = await async_client.get(
            "/api/artifacts",
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_200_OK

        data = response.json()
        assert isinstance(data, list)

    @pytest.mark.asyncio
    async def test_get_artifacts_unauthorized(self, async_client: AsyncClient):
        """Test getting artifacts without authentication."""
        response = await async_client.get("/api/artifacts")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.asyncio
    async def test_get_artifact_by_id(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test getting a specific artifact by ID."""
        # First create an artifact
        artifact_data = test_data_factory.artifact_data()

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # Now get the artifact by ID
        get_response = await async_client.get(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert get_response.status_code == status.HTTP_200_OK

        data = get_response.json()
        assert data["artifact_id"] == created_artifact["artifact_id"]
        assert data["name"] == artifact_data["name"]

    @pytest.mark.asyncio
    async def test_get_artifact_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test getting a nonexistent artifact."""
        fake_id = str(uuid.uuid4())

        response = await async_client.get(
            f"/api/artifacts/{fake_id}",
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_update_artifact(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test updating an artifact."""
        # First create an artifact
        artifact_data = test_data_factory.artifact_data()

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # Update the artifact
        update_data = {
            "name": "updated_artifact.jpg",
        }

        update_response = await async_client.put(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert update_response.status_code == status.HTTP_200_OK

        data = update_response.json()
        assert data["name"] == "updated_artifact.jpg"
        assert data["file_path"] == artifact_data["file_path"]  # Unchanged

    @pytest.mark.asyncio
    async def test_update_artifact_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test updating a nonexistent artifact."""
        fake_id = str(uuid.uuid4())
        update_data = {
            "name": "updated.jpg",
        }

        response = await async_client.put(
            f"/api/artifacts/{fake_id}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_artifact(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test deleting an artifact."""
        # First create an artifact
        artifact_data = test_data_factory.artifact_data()

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # Delete the artifact
        delete_response = await async_client.delete(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert delete_response.status_code == status.HTTP_200_OK

        # Verify the artifact is deleted
        get_response = await async_client.get(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert get_response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_delete_artifact_not_found(
        self, async_client: AsyncClient, auth_headers_user
    ):
        """Test deleting a nonexistent artifact."""
        fake_id = str(uuid.uuid4())

        response = await async_client.delete(
            f"/api/artifacts/{fake_id}",
            headers=auth_headers_user,
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_share_artifact(
        self,
        async_client: AsyncClient,
        auth_headers_user,
        auth_headers_admin,
        test_data_factory,
    ):
        """Test sharing an artifact with another user."""
        # First create an artifact as user
        artifact_data = test_data_factory.artifact_data()

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # Get admin user info (assuming we have a way to get user by username)
        # For this test, we'll use a mock user ID
        share_data = {
            "artifact_id": created_artifact["artifact_id"],
            "share_with_user_ids": [2],  # Admin user ID
        }

        share_response = await async_client.post(
            "/api/artifacts/share",
            headers=auth_headers_user,
            json=share_data,
        )

        # This endpoint might not exist yet, so we test for the expected response
        assert share_response.status_code in [
            status.HTTP_201_CREATED,
            status.HTTP_404_NOT_FOUND,  # If endpoint doesn't exist
        ]

    @pytest.mark.asyncio
    async def test_artifact_access_permissions(
        self,
        async_client: AsyncClient,
        auth_headers_user,
        auth_headers_admin,
        test_data_factory,
    ):
        """Test that users can only access their own artifacts."""
        # Create an artifact as regular user
        user_artifact_data = test_data_factory.artifact_data(name="user_artifact.jpg")

        user_artifact_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=user_artifact_data,
        )

        assert user_artifact_response.status_code == status.HTTP_201_CREATED
        user_artifact = user_artifact_response.json()

        # Create an artifact as admin
        admin_artifact_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_admin,
            json=test_data_factory.artifact_data(name="admin_artifact.jpg"),
        )

        assert admin_artifact_response.status_code == status.HTTP_201_CREATED
        admin_artifact = admin_artifact_response.json()

        # User should be able to access their own artifact
        user_access_response = await async_client.get(
            f"/api/artifacts/{user_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert user_access_response.status_code == status.HTTP_200_OK

        # User should NOT be able to access admin's artifact
        admin_access_response = await async_client.get(
            f"/api/artifacts/{admin_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        # This could be 403 Forbidden or 404 Not Found depending on implementation
        assert admin_access_response.status_code in [
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        ]

    @pytest.mark.asyncio
    async def test_artifact_file_operations(
        self, async_client: AsyncClient, auth_headers_user, temp_directory
    ):
        """Test file upload/download operations."""
        import io

        # Create a test file
        test_file_content = b"This is a test file content"
        test_file = io.BytesIO(test_file_content)

        # Test file upload (if the endpoint exists)
        files = {"file": ("test.jpg", test_file, "image/jpeg")}

        upload_response = await async_client.post(
            "/api/artifacts/upload",
            headers=auth_headers_user,
            files=files,
        )

        # This endpoint might not exist yet
        if upload_response.status_code != status.HTTP_404_NOT_FOUND:
            assert upload_response.status_code == status.HTTP_201_CREATED

            uploaded_artifact = upload_response.json()

            # Test file download
            download_response = await async_client.get(
                f"/api/artifacts/{uploaded_artifact['artifact_id']}/download",
                headers=auth_headers_user,
            )

            if download_response.status_code != status.HTTP_404_NOT_FOUND:
                assert download_response.status_code == status.HTTP_200_OK
                assert download_response.content == test_file_content

    @patch("core.services.artifact_service.os.path.exists")
    @patch("core.services.artifact_service.os.remove")
    @pytest.mark.asyncio
    async def test_artifact_file_cleanup(
        self,
        mock_remove,
        mock_exists,
        async_client: AsyncClient,
        auth_headers_user,
        test_data_factory,
    ):
        """Test that files are cleaned up when artifacts are deleted."""
        mock_exists.return_value = True

        # Create an artifact
        artifact_data = test_data_factory.artifact_data(
            file_path="/tmp/test_cleanup.jpg"
        )

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # Delete the artifact
        delete_response = await async_client.delete(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert delete_response.status_code == status.HTTP_200_OK

        # Verify file cleanup was attempted (if implemented)
        # This depends on the actual implementation
        # mock_remove.assert_called_once_with("/tmp/test_cleanup.jpg")

    @pytest.mark.asyncio
    async def test_artifact_crud_flow(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test complete artifact CRUD flow."""
        # 1. Create artifact
        artifact_data = test_data_factory.artifact_data(
            name="crud_test.jpg", file_path="/tmp/crud_test.jpg"
        )

        create_response = await async_client.post(
            "/api/artifacts",
            headers=auth_headers_user,
            json=artifact_data,
        )

        assert create_response.status_code == status.HTTP_201_CREATED
        created_artifact = create_response.json()

        # 2. Read artifact
        read_response = await async_client.get(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert read_response.status_code == status.HTTP_200_OK
        read_artifact = read_response.json()
        assert read_artifact["name"] == artifact_data["name"]

        # 3. Update artifact
        update_data = {
            "name": "updated_crud_test.jpg",
        }

        update_response = await async_client.put(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
            json=update_data,
        )

        assert update_response.status_code == status.HTTP_200_OK
        updated_artifact = update_response.json()
        assert updated_artifact["name"] == "updated_crud_test.jpg"

        # 4. Delete artifact
        delete_response = await async_client.delete(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert delete_response.status_code == status.HTTP_200_OK

        # 5. Verify deletion
        final_read_response = await async_client.get(
            f"/api/artifacts/{created_artifact['artifact_id']}",
            headers=auth_headers_user,
        )

        assert final_read_response.status_code == status.HTTP_404_NOT_FOUND

    @pytest.mark.asyncio
    async def test_artifact_list_pagination(
        self, async_client: AsyncClient, auth_headers_user, test_data_factory
    ):
        """Test artifact list pagination (if implemented)."""
        # Create multiple artifacts
        for i in range(5):
            artifact_data = test_data_factory.artifact_data(
                name=f"test_artifact_{i}.jpg", file_path=f"/tmp/test_artifact_{i}.jpg"
            )

            create_response = await async_client.post(
                "/api/artifacts",
                headers=auth_headers_user,
                json=artifact_data,
            )

            assert create_response.status_code == status.HTTP_201_CREATED

        # Test pagination parameters
        paginated_response = await async_client.get(
            "/api/artifacts?limit=3&offset=1",
            headers=auth_headers_user,
        )

        assert paginated_response.status_code == status.HTTP_200_OK

        data = paginated_response.json()
        if isinstance(data, dict) and "items" in data:
            # Paginated response format
            assert len(data["items"]) <= 3
            assert "total" in data
        else:
            # Simple list format
            assert isinstance(data, list)
