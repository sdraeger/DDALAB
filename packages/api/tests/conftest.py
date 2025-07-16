"""Test configuration and fixtures."""

import asyncio
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Dict, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from faker import Faker
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from ..core.config import Settings, get_server_settings
from ..core.database import get_db_session, get_minio_client
from ..core.middleware import AuthMiddleware, DatabaseMiddleware
from ..core.models import Base, User
from ..core.security import get_password_hash
from ..routes.artifacts import router as artifacts_router
from ..routes.auth import router as auth_router
from ..routes.health import router as health_router
from ..routes.tickets import router as tickets_router
from ..routes.users import router as users_router

settings = get_server_settings()

# Use a separate test database
SQLALCHEMY_DATABASE_URL = (
    f"postgresql+asyncpg://{settings.db_user}:{settings.db_password}"
    f"@{settings.db_host}:{settings.db_port}/{settings.db_name}_test"
)

# Create test app
test_app = FastAPI(title="Test DDALAB API", version="0.1.0")

# Add minimal middleware
test_app.add_middleware(DatabaseMiddleware)
test_app.add_middleware(AuthMiddleware)
test_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include essential routers
test_app.include_router(health_router, prefix="/api/health", tags=["health"])
test_app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
test_app.include_router(tickets_router, prefix="/api/tickets", tags=["tickets"])
test_app.include_router(users_router, prefix="/api/users", tags=["users"])
test_app.include_router(artifacts_router, prefix="/api/artifacts", tags=["artifacts"])

# Use test app instead of main app
app = test_app

# Initialize Faker
fake = Faker()

# Test database URL
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def test_settings() -> Settings:
    """Create test settings with safe defaults."""
    return Settings(
        # Development settings
        reload=False,
        # API settings
        api_host="localhost",
        api_port=8000,
        # Institution name
        institution_name="Test Institution",
        # Data directory settings
        data_dir="/tmp/test_data",
        anonymize_edf=False,
        # DDA binary settings
        dda_binary_path="/usr/bin/dda",
        # PostgreSQL Database settings
        db_host="localhost",
        db_port=5432,
        db_name="test_db",
        db_user="test_user",
        db_password="test_password",
        # Authentication settings
        jwt_secret_key="test_secret_key_123456789",
        jwt_algorithm="HS256",
        auth_enabled=True,
        token_expiration_minutes=30,
        # Allowed directories
        allowed_dirs=["/tmp", "/test"],
        # Minio settings
        minio_host="localhost:9000",
        minio_access_key="testkey",
        minio_secret_key="testsecret",
        minio_bucket_name="test-bucket",
        # OpenTelemetry settings
        otlp_host="localhost",
        otlp_port=4317,
    )


@pytest_asyncio.fixture
async def test_engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
        poolclass=StaticPool,
        connect_args={
            "check_same_thread": False,
        },
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def test_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session."""
    async_session_maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)

    async with async_session_maker() as session:
        yield session


@pytest.fixture
def mock_minio_client():
    """Create a mock MinIO client."""
    mock_client = MagicMock(spec=Minio)
    mock_client.bucket_exists.return_value = True
    mock_client.make_bucket.return_value = None
    mock_client.put_object.return_value = MagicMock()
    mock_client.get_object.return_value = MagicMock()
    mock_client.remove_object.return_value = None
    mock_client.list_objects.return_value = []
    return mock_client


@pytest.fixture
def override_dependencies(test_session, mock_minio_client, test_settings):
    """Override FastAPI dependencies for testing."""

    def get_test_db():
        yield test_session

    def get_test_minio():
        yield mock_minio_client

    app.dependency_overrides[get_db_session] = get_test_db
    app.dependency_overrides[get_minio_client] = get_test_minio

    # Override settings functions to use test settings
    from unittest.mock import patch

    with (
        patch("..core.config.get_server_settings", return_value=test_settings),
        patch("..core.auth.settings", test_settings),
    ):
        yield

    # Clean up
    app.dependency_overrides = {}


@pytest.fixture
def client(override_dependencies) -> Generator[TestClient, None, None]:
    """Create test client."""
    with TestClient(app) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def async_client(override_dependencies) -> AsyncGenerator[AsyncClient, None]:
    """Create async test client."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as test_client:
        yield test_client


@pytest_asyncio.fixture
async def test_user(test_session: AsyncSession) -> User:
    """Create a test user."""
    user = User(
        username="testuser",
        email="test@example.com",
        password_hash=get_password_hash("testpassword"),
        first_name="Test",
        last_name="User",
        is_active=True,
        is_admin=False,
    )
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_admin_user(test_session: AsyncSession) -> User:
    """Create a test admin user."""
    admin_user = User(
        username="admin",
        email="admin@example.com",
        password_hash=get_password_hash("adminpassword"),
        first_name="Admin",
        last_name="User",
        is_active=True,
        is_admin=True,
    )
    test_session.add(admin_user)
    await test_session.commit()
    await test_session.refresh(admin_user)
    return admin_user


@pytest.fixture
def temp_directory():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as temp_dir:
        yield Path(temp_dir)


@pytest.fixture
def sample_edf_file(temp_directory):
    """Create a sample EDF file for testing."""
    edf_path = temp_directory / "sample.edf"
    # Create a minimal EDF file content for testing
    with open(edf_path, "wb") as f:
        # EDF header (simplified)
        f.write(b"0" * 256)  # Basic EDF header structure
    return edf_path


@pytest.fixture
def auth_headers_user(test_user):
    """Create authentication headers for test user."""
    from datetime import timedelta

    from ..core.security import create_jwt_token

    token = create_jwt_token(
        subject=test_user.username,
        expires_delta=timedelta(minutes=30),
        secret_key="test_secret_key_123456789",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_admin(test_admin_user):
    """Create authentication headers for admin user."""
    from datetime import timedelta

    from ..core.security import create_jwt_token

    token = create_jwt_token(
        subject=test_admin_user.username,
        expires_delta=timedelta(minutes=30),
        secret_key="test_secret_key_123456789",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_dda_binary():
    """Mock DDA binary responses."""
    return MagicMock()


@pytest.fixture(autouse=True)
def mock_external_services(monkeypatch):
    """Mock external services by default."""
    # Mock OpenTelemetry
    monkeypatch.setattr("opentelemetry.trace.set_tracer_provider", MagicMock())

    # Mock MinIO initialization in main.py
    mock_minio = MagicMock(spec=Minio)
    mock_minio.bucket_exists.return_value = True
    monkeypatch.setattr("main.Minio", lambda *args, **kwargs: mock_minio)

    # Mock cache manager
    mock_cache = AsyncMock()
    monkeypatch.setattr("core.edf.edf_cache.get_cache_manager", lambda: mock_cache)
    monkeypatch.setattr("core.edf.edf_cache.clear_global_cache", MagicMock())


class TestDataFactory:
    """Factory class for creating test data."""

    @staticmethod
    def user_data(**kwargs) -> Dict:
        """Generate user test data."""
        default_data = {
            "username": fake.user_name(),
            "email": fake.email(),
            "password": fake.password(),
            "first_name": fake.first_name(),
            "last_name": fake.last_name(),
        }
        default_data.update(kwargs)
        return default_data

    @staticmethod
    def ticket_data(**kwargs) -> Dict:
        """Generate ticket test data."""
        default_data = {
            "title": fake.sentence(nb_words=4),
            "description": fake.text(max_nb_chars=200),
            "status": "open",
        }
        default_data.update(kwargs)
        return default_data

    @staticmethod
    def artifact_data(**kwargs) -> Dict:
        """Generate artifact test data."""
        default_data = {
            "name": fake.file_name(),
            "file_path": f"/tmp/{fake.file_name()}",
        }
        default_data.update(kwargs)
        return default_data


@pytest.fixture
def test_data_factory():
    """Provide test data factory."""
    return TestDataFactory
