"""Unit tests for services."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.models import Artifact, FavoriteFile, Ticket, User, UserPreferences
from ...core.services import (
    ArtifactService,
    FavoriteFilesService,
    LocalUserService,
    TicketService,
    UserPreferencesService,
    UserService,
)
from ...schemas.user import UserCreate, UserUpdate

pytestmark = pytest.mark.asyncio


@pytest.mark.unit
class TestUserService:
    """Test user service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def user_service(self, mock_session):
        """Create a user service instance."""
        return UserService(mock_session)

    @pytest.mark.asyncio
    async def test_create_user_success(self, user_service, mock_session):
        """Test successful user creation."""
        user_data = UserCreate(
            username="testuser",
            email="test@example.com",
            password="password123",
            first_name="Test",
            last_name="User",
        )

        # Mock the repository create method
        mock_user = User(
            username="testuser",
            email="test@example.com",
            password_hash="hashed_password",
            first_name="Test",
            last_name="User",
        )
        user_service.repo.create = AsyncMock(return_value=mock_user)

        result = await user_service.register_user(user_data)

        assert result.username == "testuser"
        assert result.email == "test@example.com"
        user_service.repo.create.assert_called_once_with(user_data)

    @pytest.mark.asyncio
    async def test_get_user_by_username(self, user_service, mock_session):
        """Test getting user by username."""
        mock_user = User(username="testuser", email="test@example.com")
        user_service.repo.get_by_username = AsyncMock(return_value=mock_user)

        result = await user_service.get_user(username="testuser")

        assert result == mock_user
        user_service.repo.get_by_username.assert_called_once_with("testuser")

    @pytest.mark.asyncio
    async def test_get_user_by_email(self, user_service, mock_session):
        """Test getting user by email."""
        mock_user = User(username="testuser", email="test@example.com")
        user_service.repo.get_by_email = AsyncMock(return_value=mock_user)

        result = await user_service.get_user(email="test@example.com")

        assert result == mock_user
        user_service.repo.get_by_email.assert_called_once_with("test@example.com")

    @pytest.mark.asyncio
    async def test_get_all_users(self, user_service, mock_session):
        """Test getting all users."""
        mock_users = [
            User(username="user1", email="user1@example.com"),
            User(username="user2", email="user2@example.com"),
        ]
        user_service.repo.get_all = AsyncMock(return_value=mock_users)

        result = await user_service.get_all_users()

        assert result == mock_users
        user_service.repo.get_all.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_user(self, user_service, mock_session):
        """Test updating a user."""
        mock_user = User(
            id=1, username="testuser", email="test@example.com", first_name="Updated"
        )
        user_service.repo.update = AsyncMock(return_value=mock_user)

        update_data = UserUpdate(first_name="Updated")
        result = await user_service.update_user(update_data, user_id=1)

        assert result.first_name == "Updated"
        user_service.repo.update.assert_called_once_with(1, update_data)

    @pytest.mark.asyncio
    async def test_delete_user(self, user_service, mock_session):
        """Test deleting a user."""
        mock_user = User(id=1, username="testuser", email="test@example.com")
        user_service.repo.delete = AsyncMock(return_value=mock_user)

        result = await user_service.delete_user(user_id=1)

        assert result == mock_user
        user_service.repo.delete.assert_called_once_with(1)


@pytest.mark.unit
class TestTicketService:
    """Test ticket service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def ticket_service(self, mock_session):
        """Create a ticket service instance."""
        return TicketService(mock_session)

    @pytest.mark.asyncio
    async def test_create_ticket(self, ticket_service, mock_session):
        """Test creating a ticket."""
        mock_ticket = Ticket(
            title="Test Ticket",
            description="Test description",
            status="open",
            user_id=1,
        )
        ticket_service.ticket_repo.create = AsyncMock(return_value=mock_ticket)

        result = await ticket_service.create_ticket(mock_ticket)

        assert result.title == "Test Ticket"
        assert result.description == "Test description"
        assert result.status == "open"
        assert result.user_id == 1
        ticket_service.ticket_repo.create.assert_called_once_with(mock_ticket)

    @pytest.mark.asyncio
    async def test_get_ticket_by_id(self, ticket_service, mock_session):
        """Test getting a ticket by ID."""
        mock_ticket = Ticket(id=1, title="Test Ticket")
        ticket_service.ticket_repo.get_by_id = AsyncMock(return_value=mock_ticket)

        result = await ticket_service.get_ticket(1)

        assert result == mock_ticket
        ticket_service.ticket_repo.get_by_id.assert_called_once_with(1)

    @pytest.mark.asyncio
    async def test_get_tickets_by_user(self, ticket_service, mock_session):
        """Test getting tickets by user ID."""
        mock_tickets = [
            Ticket(id=1, title="Ticket 1", user_id=1),
            Ticket(id=2, title="Ticket 2", user_id=1),
        ]
        ticket_service.ticket_repo.get_by_user_id = AsyncMock(return_value=mock_tickets)

        result = await ticket_service.get_tickets_by_user_id(1)

        assert result == mock_tickets
        ticket_service.ticket_repo.get_by_user_id.assert_called_once_with(1)


@pytest.mark.unit
class TestArtifactService:
    """Test artifact service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def artifact_service(self, mock_session):
        """Create an artifact service instance."""
        return ArtifactService(mock_session)

    @pytest.mark.asyncio
    async def test_create_artifact(self, artifact_service, mock_session):
        """Test creating an artifact."""
        from ...schemas.artifacts import ArtifactCreate

        artifact_data = ArtifactCreate(
            name="test_artifact.jpg", file_path="/tmp/test_artifact.jpg", user_id=1
        )

        mock_artifact = Artifact(
            name="test_artifact.jpg", file_path="/tmp/test_artifact.jpg", user_id=1
        )
        artifact_service.artifact_repository.create = AsyncMock(
            return_value=mock_artifact
        )

        result = await artifact_service.create_artifact(artifact_data)

        assert result.name == "test_artifact.jpg"
        assert result.file_path == "/tmp/test_artifact.jpg"
        assert result.user_id == 1
        artifact_service.artifact_repository.create.assert_called_once_with(
            artifact_data
        )

    @pytest.mark.asyncio
    async def test_get_artifact_by_id(self, artifact_service, mock_session):
        """Test getting an artifact by ID."""
        import uuid

        artifact_id = uuid.uuid4()
        mock_artifact = Artifact(id=artifact_id, name="test_artifact.jpg")
        artifact_service.artifact_repository.get_by_id = AsyncMock(
            return_value=mock_artifact
        )

        result = await artifact_service.get_artifact(artifact_id)

        assert result == mock_artifact
        artifact_service.artifact_repository.get_by_id.assert_called_once_with(
            artifact_id
        )

    @pytest.mark.asyncio
    async def test_list_artifacts_by_user(self, artifact_service, mock_session):
        """Test listing artifacts by user."""
        import uuid
        from datetime import datetime, timezone

        mock_user = User(id=1, username="testuser", email="test@example.com")
        mock_artifacts = [
            Artifact(
                id=uuid.uuid4(),
                name="artifact1.jpg",
                file_path="/path/to/artifact1.jpg",
                user_id=1,
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            ),
            Artifact(
                id=uuid.uuid4(),
                name="artifact2.jpg",
                file_path="/path/to/artifact2.jpg",
                user_id=1,
                created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            ),
        ]

        # Mock both repository methods
        artifact_service.artifact_repository.get_by_user_id = AsyncMock(
            return_value=mock_artifacts
        )
        artifact_service.artifact_share_repository.get_by_user_id = AsyncMock(
            return_value=[]
        )

        result = await artifact_service.list_artifacts(mock_user)

        assert len(result) == 2
        assert result[0].name == "artifact1.jpg"
        assert result[1].name == "artifact2.jpg"
        artifact_service.artifact_repository.get_by_user_id.assert_called_once()
        artifact_service.artifact_share_repository.get_by_user_id.assert_called_once()


@pytest.mark.unit
class TestFavoriteFilesService:
    """Test favorite files service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def favorite_files_service(self, mock_session):
        """Create a favorite files service instance."""
        return FavoriteFilesService(mock_session)

    @pytest.mark.asyncio
    async def test_toggle_favorite_file(self, favorite_files_service, mock_session):
        """Test toggling a favorite file."""
        mock_favorite = FavoriteFile(user_id=1, file_path="/path/to/file.edf")
        favorite_files_service.favorite_files_repo.toggle_favorite = AsyncMock(
            return_value=mock_favorite
        )

        result = await favorite_files_service.toggle_favorite(
            user_id=1, file_path="/path/to/file.edf"
        )

        assert result.user_id == 1
        assert result.file_path == "/path/to/file.edf"
        favorite_files_service.favorite_files_repo.toggle_favorite.assert_called_once_with(
            1, "/path/to/file.edf"
        )

    @pytest.mark.asyncio
    async def test_get_user_favorites(self, favorite_files_service, mock_session):
        """Test getting user favorites."""
        mock_favorites = [
            FavoriteFile(id=1, user_id=1, file_path="/path/to/file1.edf"),
            FavoriteFile(id=2, user_id=1, file_path="/path/to/file2.edf"),
        ]
        favorite_files_service.favorite_files_repo.get_by_user_id = AsyncMock(
            return_value=mock_favorites
        )

        result = await favorite_files_service.get_favorites(1)

        assert result == mock_favorites
        favorite_files_service.favorite_files_repo.get_by_user_id.assert_called_once_with(
            1, 0, None
        )

    @pytest.mark.asyncio
    async def test_get_by_user_and_file_path(
        self, favorite_files_service, mock_session
    ):
        """Test getting favorite by user and file path."""
        mock_favorite = FavoriteFile(id=1, user_id=1, file_path="/path/to/file.edf")
        favorite_files_service.favorite_files_repo.get_by_user_and_file_path = (
            AsyncMock(return_value=mock_favorite)
        )

        result = await favorite_files_service.get_by_user_and_file_path(
            user_id=1, file_path="/path/to/file.edf"
        )

        assert result == mock_favorite
        favorite_files_service.favorite_files_repo.get_by_user_and_file_path.assert_called_once_with(
            1, "/path/to/file.edf"
        )


@pytest.mark.unit
class TestLocalUserService:
    """Test local user service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def local_user_service(self, mock_session):
        """Create a local user service instance."""
        return LocalUserService(mock_session)

    @pytest.mark.asyncio
    async def test_default_user_constants(self, local_user_service):
        """Test that default user constants are properly defined."""
        assert local_user_service.DEFAULT_USER_ID == "local-user"
        assert local_user_service.DEFAULT_USERNAME == "local"
        assert local_user_service.DEFAULT_EMAIL == "local@localhost"
        assert local_user_service.DEFAULT_FIRST_NAME == "Local"
        assert local_user_service.DEFAULT_LAST_NAME == "User"
        assert local_user_service.DEFAULT_IS_ADMIN is True
        assert local_user_service.DEFAULT_IS_ACTIVE is True

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_creates_new_user(
        self, local_user_service, mock_session
    ):
        """Test creating a new default user when none exists."""
        # Mock repository to return None (no existing user)
        local_user_service.repository.get_by_username = AsyncMock(return_value=None)

        # Mock the created user
        mock_user = User(
            username="local",
            email="local@localhost",
            first_name="Local",
            last_name="User",
            is_admin=True,
            is_active=True,
            password_hash="",
        )
        local_user_service.repository.create = AsyncMock(return_value=mock_user)

        result = await local_user_service.ensure_default_user_exists()

        # Verify the user was created with correct properties
        assert result.username == "local"
        assert result.email == "local@localhost"
        assert result.first_name == "Local"
        assert result.last_name == "User"
        assert result.is_admin is True
        assert result.is_active is True
        assert result.password_hash == ""

        # Verify repository methods were called
        local_user_service.repository.get_by_username.assert_called_once_with("local")
        local_user_service.repository.create.assert_called_once()

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_returns_existing_user(
        self, local_user_service, mock_session
    ):
        """Test returning existing default user when it already exists."""
        # Mock existing user with correct properties
        existing_user = User(
            id=1,
            username="local",
            email="local@localhost",
            first_name="Local",
            last_name="User",
            is_admin=True,
            is_active=True,
            password_hash="",
        )
        local_user_service.repository.get_by_username = AsyncMock(
            return_value=existing_user
        )

        result = await local_user_service.ensure_default_user_exists()

        # Verify the existing user was returned
        assert result == existing_user
        assert result.username == "local"
        assert result.is_admin is True
        assert result.is_active is True

        # Verify repository methods were called
        local_user_service.repository.get_by_username.assert_called_once_with("local")
        # Create should not be called since user exists
        local_user_service.repository.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_updates_existing_user_properties(
        self, local_user_service, mock_session
    ):
        """Test updating existing user properties to match local mode requirements."""
        # Mock existing user with incorrect properties
        existing_user = User(
            id=1,
            username="local",
            email="old@example.com",  # Wrong email
            first_name="Old",  # Wrong first name
            last_name="Name",  # Wrong last name
            is_admin=False,  # Should be True
            is_active=False,  # Should be True
            password_hash="old_hash",
        )
        local_user_service.repository.get_by_username = AsyncMock(
            return_value=existing_user
        )

        # Mock database session methods
        mock_session.flush = AsyncMock()
        mock_session.refresh = AsyncMock()

        result = await local_user_service.ensure_default_user_exists()

        # Verify the user properties were updated
        assert result.is_admin is True
        assert result.is_active is True
        assert result.email == "local@localhost"
        assert result.first_name == "Local"
        assert result.last_name == "User"
        assert result.updated_at is not None

        # Verify database operations were called
        mock_session.flush.assert_called_once()
        mock_session.refresh.assert_called_once_with(existing_user)

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_no_update_when_properties_correct(
        self, local_user_service, mock_session
    ):
        """Test that no update occurs when existing user has correct properties."""
        # Mock existing user with correct properties
        existing_user = User(
            id=1,
            username="local",
            email="local@localhost",
            first_name="Local",
            last_name="User",
            is_admin=True,
            is_active=True,
            password_hash="",
        )
        local_user_service.repository.get_by_username = AsyncMock(
            return_value=existing_user
        )

        # Mock database session methods
        mock_session.flush = AsyncMock()
        mock_session.refresh = AsyncMock()

        result = await local_user_service.ensure_default_user_exists()

        # Verify the user was returned unchanged
        assert result == existing_user

        # Verify no database updates were made
        mock_session.flush.assert_not_called()
        mock_session.refresh.assert_not_called()

    @pytest.mark.asyncio
    async def test_get_default_user_calls_ensure_default_user_exists(
        self, local_user_service, mock_session
    ):
        """Test that get_default_user calls ensure_default_user_exists."""
        mock_user = User(
            username="local",
            email="local@localhost",
            first_name="Local",
            last_name="User",
            is_admin=True,
            is_active=True,
        )

        # Mock ensure_default_user_exists
        local_user_service.ensure_default_user_exists = AsyncMock(
            return_value=mock_user
        )

        result = await local_user_service.get_default_user()

        # Verify the method was called and returned the user
        assert result == mock_user
        local_user_service.ensure_default_user_exists.assert_called_once()

    @pytest.mark.asyncio
    async def test_health_check_success(self, local_user_service, mock_session):
        """Test successful health check."""
        mock_user = User(username="local", email="local@localhost")
        local_user_service.get_default_user = AsyncMock(return_value=mock_user)

        result = await local_user_service.health_check()

        assert result is True
        local_user_service.get_default_user.assert_called_once()

    @pytest.mark.asyncio
    async def test_health_check_failure(self, local_user_service, mock_session):
        """Test health check failure when database operations fail."""
        local_user_service.get_default_user = AsyncMock(
            side_effect=Exception("Database error")
        )

        result = await local_user_service.health_check()

        assert result is False
        local_user_service.get_default_user.assert_called_once()

    @pytest.mark.asyncio
    async def test_from_db_factory_method(self, mock_session):
        """Test the from_db factory method."""
        service = LocalUserService.from_db(mock_session)

        assert isinstance(service, LocalUserService)
        assert service.db == mock_session
        assert service.repository is not None

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_handles_database_errors(
        self, local_user_service, mock_session
    ):
        """Test error handling in ensure_default_user_exists."""
        local_user_service.repository.get_by_username = AsyncMock(
            side_effect=Exception("Database connection error")
        )

        with pytest.raises(Exception, match="Database connection error"):
            await local_user_service.ensure_default_user_exists()

    @pytest.mark.asyncio
    async def test_ensure_default_user_exists_handles_creation_errors(
        self, local_user_service, mock_session
    ):
        """Test error handling during user creation."""
        # Mock no existing user
        local_user_service.repository.get_by_username = AsyncMock(return_value=None)
        # Mock creation failure
        local_user_service.repository.create = AsyncMock(
            side_effect=Exception("User creation failed")
        )

        with pytest.raises(Exception, match="User creation failed"):
            await local_user_service.ensure_default_user_exists()

        local_user_service.repository.get_by_username.assert_called_once_with("local")
        local_user_service.repository.create.assert_called_once()


@pytest.mark.unit
class TestUserPreferencesService:
    """Test user preferences service functionality."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock database session."""
        return AsyncMock(spec=AsyncSession)

    @pytest.fixture
    def preferences_service(self, mock_session):
        """Create a user preferences service instance."""
        return UserPreferencesService(mock_session)

    @pytest.mark.asyncio
    async def test_get_user_preferences(self, preferences_service, mock_session):
        """Test getting user preferences."""
        mock_preferences = UserPreferences(
            user_id=1, theme="dark", eeg_zoom_factor=0.05
        )
        preferences_service.repo.get_by_user_id = AsyncMock(
            return_value=mock_preferences
        )

        result = await preferences_service.get_preferences(1)

        assert result == mock_preferences
        preferences_service.repo.get_by_user_id.assert_called_once_with(1)

    @pytest.mark.asyncio
    async def test_update_user_preferences(self, preferences_service, mock_session):
        """Test updating user preferences."""
        mock_preferences = UserPreferences(
            user_id=1, theme="dark", eeg_zoom_factor=0.05
        )
        preferences_service.repo.update_preferences = AsyncMock(
            return_value=mock_preferences
        )

        preferences_data = {"theme": "dark"}
        result = await preferences_service.update_preferences(1, preferences_data)

        assert result.theme == "dark"
        preferences_service.repo.update_preferences.assert_called_once_with(
            1, preferences_data
        )


@pytest.mark.unit
class TestServiceIntegration:
    """Test service integration scenarios."""

    @pytest.mark.asyncio
    async def test_user_service_with_dependencies(self):
        """Test user service with real dependencies."""
        mock_session = AsyncMock(spec=AsyncSession)
        user_service = UserService(mock_session)

        # Test that the service can be instantiated with dependencies
        assert user_service is not None
        assert user_service.repo is not None

        # Create a simple mock user for testing
        user_data = UserCreate(
            username="integrationtest",
            email="integration@example.com",
            password="password123",
            first_name="Integration",
            last_name="Test",
        )

        mock_user = User(
            username="integrationtest",
            email="integration@example.com",
            password_hash="hashed_password",
            first_name="Integration",
            last_name="Test",
        )
        user_service.repo.create = AsyncMock(return_value=mock_user)

        result = await user_service.register_user(user_data)

        assert result.username == "integrationtest"
        user_service.repo.create.assert_called_once_with(user_data)

    @pytest.mark.asyncio
    async def test_error_handling_in_services(self):
        """Test error handling across different services."""
        mock_session = AsyncMock(spec=AsyncSession)

        # Test UserService error handling
        user_service = UserService(mock_session)
        user_service.repo.get_by_username = AsyncMock(
            side_effect=Exception("Database error")
        )

        with pytest.raises(Exception):
            await user_service.get_user(username="nonexistent")

        # Test TicketService error handling
        ticket_service = TicketService(mock_session)
        ticket_service.ticket_repo.get_by_id = AsyncMock(
            side_effect=Exception("Database error")
        )

        with pytest.raises(Exception):
            await ticket_service.get_ticket(999)
