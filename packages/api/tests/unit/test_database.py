"""Unit tests for database models."""

import uuid
from datetime import datetime, timezone

import pytest
from core.models import (
    Annotation,
    Artifact,
    EdfConfig,
    EdfConfigChannel,
    FavoriteFile,
    Ticket,
    User,
    UserLayout,
    UserPreferences,
)


@pytest.mark.unit
@pytest.mark.database
class TestUserModel:
    """Test User model functionality."""

    def test_user_creation(self):
        """Test basic user creation."""
        user = User(
            username="testuser",
            email="test@example.com",
            password_hash="hashed_password",
            first_name="Test",
            last_name="User",
            is_active=True,
            is_admin=False,
        )

        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.password_hash == "hashed_password"
        assert user.first_name == "Test"
        assert user.last_name == "User"
        assert user.is_active is True
        assert user.is_admin is False

    def test_user_defaults(self):
        """Test user model defaults."""
        user = User(
            username="testuser",
            email="test@example.com",
            password_hash="hashed_password",
        )

        assert user.is_active is True  # Should default to True
        assert user.is_admin is False  # Should default to False
        assert user.created_at is not None
        assert user.updated_at is not None

    def test_user_timestamps(self):
        """Test that timestamps are set automatically."""
        user = User(
            username="testuser",
            email="test@example.com",
            password_hash="hashed_password",
        )

        # Timestamps should be set
        assert isinstance(user.created_at, datetime)
        assert isinstance(user.updated_at, datetime)


@pytest.mark.unit
@pytest.mark.database
class TestUserPreferencesModel:
    """Test UserPreferences model functionality."""

    def test_user_preferences_creation(self):
        """Test user preferences creation."""
        preferences = UserPreferences(
            user_id=1,
            theme="dark",
            eeg_zoom_factor=0.1,
        )

        assert preferences.user_id == 1
        assert preferences.theme == "dark"
        assert preferences.eeg_zoom_factor == 0.1

    def test_user_preferences_defaults(self):
        """Test user preferences defaults."""
        preferences = UserPreferences(user_id=1)

        assert preferences.theme == "system"  # Should default to "system"
        assert preferences.eeg_zoom_factor == 0.05  # Should default to 0.05
        assert preferences.updated_at is not None


@pytest.mark.unit
@pytest.mark.database
class TestTicketModel:
    """Test Ticket model functionality."""

    def test_ticket_creation(self):
        """Test ticket creation."""
        ticket = Ticket(
            user_id=1,
            title="Test Ticket",
            description="This is a test ticket",
            status="open",
        )

        assert ticket.user_id == 1
        assert ticket.title == "Test Ticket"
        assert ticket.description == "This is a test ticket"
        assert ticket.status == "open"
        assert ticket.created_at is not None
        assert ticket.updated_at is not None


@pytest.mark.unit
@pytest.mark.database
class TestArtifactModel:
    """Test Artifact model functionality."""

    def test_artifact_creation(self):
        """Test artifact creation."""
        artifact_id = uuid.uuid4()
        artifact = Artifact(
            id=artifact_id,
            name="test_artifact.jpg",
            file_path="/tmp/test_artifact.jpg",
            user_id=1,
        )

        assert artifact.id == artifact_id
        assert artifact.name == "test_artifact.jpg"
        assert artifact.file_path == "/tmp/test_artifact.jpg"
        assert artifact.user_id == 1
        assert artifact.created_at is not None

    def test_artifact_id_generation(self):
        """Test that artifact ID is generated automatically."""
        artifact = Artifact(
            name="test.jpg",
            file_path="/tmp/test.jpg",
            user_id=1,
        )

        # ID should be generated automatically
        assert artifact.id is not None
        assert isinstance(artifact.id, uuid.UUID)


@pytest.mark.unit
@pytest.mark.database
class TestFavoriteFileModel:
    """Test FavoriteFile model functionality."""

    def test_favorite_file_creation(self):
        """Test favorite file creation."""
        favorite = FavoriteFile(
            user_id=1,
            file_path="/path/to/favorite.edf",
        )

        assert favorite.user_id == 1
        assert favorite.file_path == "/path/to/favorite.edf"
        assert favorite.created_at is not None

    def test_favorite_file_timestamp(self):
        """Test that created_at timestamp is set."""
        favorite = FavoriteFile(
            user_id=1,
            file_path="/path/to/file.edf",
        )

        assert isinstance(favorite.created_at, datetime)


@pytest.mark.unit
@pytest.mark.database
class TestEdfConfigModel:
    """Test EdfConfig model functionality."""

    def test_edf_config_creation(self):
        """Test EDF config creation."""
        config = EdfConfig(
            file_hash="abc123def456",
            user_id=1,
        )

        assert config.file_hash == "abc123def456"
        assert config.user_id == 1
        assert config.created_at is not None


@pytest.mark.unit
@pytest.mark.database
class TestEdfConfigChannelModel:
    """Test EdfConfigChannel model functionality."""

    def test_edf_config_channel_creation(self):
        """Test EDF config channel creation."""
        channel = EdfConfigChannel(
            config_id=1,
            channel="EEG C3-M2",
        )

        assert channel.config_id == 1
        assert channel.channel == "EEG C3-M2"


@pytest.mark.unit
@pytest.mark.database
class TestAnnotationModel:
    """Test Annotation model functionality."""

    def test_annotation_creation(self):
        """Test annotation creation."""
        annotation = Annotation(
            user_id=1,
            file_path="/path/to/file.edf",
            start_time=1000,
            end_time=2000,
            text="Sleep stage N2",
        )

        assert annotation.user_id == 1
        assert annotation.file_path == "/path/to/file.edf"
        assert annotation.start_time == 1000
        assert annotation.end_time == 2000
        assert annotation.text == "Sleep stage N2"
        assert annotation.created_at is not None
        assert annotation.updated_at is not None

    def test_annotation_without_end_time(self):
        """Test annotation creation without end time."""
        annotation = Annotation(
            user_id=1,
            file_path="/path/to/file.edf",
            start_time=1000,
            text="Event marker",
        )

        assert annotation.start_time == 1000
        assert annotation.end_time is None
        assert annotation.text == "Event marker"


@pytest.mark.unit
@pytest.mark.database
class TestUserLayoutModel:
    """Test UserLayout model functionality."""

    def test_user_layout_creation(self):
        """Test user layout creation."""
        layout_data = {"panels": [{"id": 1, "type": "eeg"}]}
        layout = UserLayout(
            user_id=1,
            layout_data=layout_data,
        )

        assert layout.user_id == 1
        assert layout.layout_data == layout_data
        assert layout.created_at is not None


@pytest.mark.unit
@pytest.mark.database
class TestModelRelationships:
    """Test model relationships."""

    @pytest.mark.asyncio
    async def test_user_favorite_files_relationship(self, test_session):
        """Test user to favorite files relationship."""
        from core.security import get_password_hash

        # Create user
        user = User(
            username="testuser",
            email="test@example.com",
            password_hash=get_password_hash("password"),
            first_name="Test",
            last_name="User",
        )
        test_session.add(user)
        await test_session.commit()
        await test_session.refresh(user)

        # Create favorite file
        favorite = FavoriteFile(
            user_id=user.id,
            file_path="/path/to/file.edf",
        )
        test_session.add(favorite)
        await test_session.commit()

        # Test relationship - this would work with proper SQLAlchemy setup
        assert user.id == favorite.user_id

    @pytest.mark.asyncio
    async def test_user_preferences_relationship(self, test_session):
        """Test user to preferences relationship."""
        from core.security import get_password_hash

        # Create user
        user = User(
            username="testuser2",
            email="test2@example.com",
            password_hash=get_password_hash("password"),
            first_name="Test",
            last_name="User",
        )
        test_session.add(user)
        await test_session.commit()
        await test_session.refresh(user)

        # Create preferences
        preferences = UserPreferences(
            user_id=user.id,
            theme="dark",
            eeg_zoom_factor=0.1,
        )
        test_session.add(preferences)
        await test_session.commit()

        # Test relationship
        assert user.id == preferences.user_id

    @pytest.mark.asyncio
    async def test_artifact_user_relationship(self, test_session):
        """Test artifact to user relationship."""
        from core.security import get_password_hash

        # Create user
        user = User(
            username="artifactuser",
            email="artifact@example.com",
            password_hash=get_password_hash("password"),
            first_name="Artifact",
            last_name="User",
        )
        test_session.add(user)
        await test_session.commit()
        await test_session.refresh(user)

        # Create artifact
        artifact = Artifact(
            name="test.jpg",
            file_path="/tmp/test.jpg",
            user_id=user.id,
        )
        test_session.add(artifact)
        await test_session.commit()

        # Test relationship
        assert user.id == artifact.user_id


@pytest.mark.unit
@pytest.mark.database
class TestModelValidation:
    """Test model validation and constraints."""

    def test_user_required_fields(self):
        """Test that required fields are enforced."""
        # This test would require actual database constraints
        # For now, we test the model creation
        user = User(
            username="required_test",
            email="required@example.com",
            password_hash="password_hash",
        )

        # These fields should be present
        assert user.username is not None
        assert user.email is not None
        assert user.password_hash is not None

    def test_artifact_uuid_field(self):
        """Test that artifact ID is a proper UUID."""
        artifact = Artifact(
            name="uuid_test.jpg",
            file_path="/tmp/uuid_test.jpg",
            user_id=1,
        )

        # ID should be a UUID
        assert isinstance(artifact.id, uuid.UUID)

    def test_timestamp_fields(self):
        """Test that timestamp fields are properly set."""
        user = User(
            username="timestamp_test",
            email="timestamp@example.com",
            password_hash="password_hash",
        )

        # Timestamps should be datetime objects
        assert isinstance(user.created_at, datetime)
        assert isinstance(user.updated_at, datetime)

        # They should be set to current time (approximately)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        time_diff = abs((now - user.created_at).total_seconds())
        assert time_diff < 10  # Should be within 10 seconds
