"""Test configuration and fixtures."""

import logging
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from core.models import Base
from dotenv import load_dotenv
from faker import Faker
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from core import registry
from core.environment import get_config_service
from core.database import get_db_session, get_minio_client
from core.middleware import AuthMiddleware, DatabaseMiddleware
from core.models import User
from core.security import get_password_hash
from core.services.artifact_service import ArtifactService
from core.services.dda_service import DDAService
from core.services.stats_service import StatsService
from core.services.ticket_service import TicketService
from core.services.user_service import UserService
from routes.artifacts import router as artifacts_router
from routes.edf import router as edf_router
from routes.auth import router as auth_router
from routes.health import router as health_router
from routes.tickets import router as tickets_router
from routes.users import router as users_router

# Set the env file for Pydantic Settings before any config is loaded
os.environ["DDALAB_ENV_FILE"] = os.path.join(
    os.path.dirname(__file__), "../../../.env.test"
)

# Load .env.test for test environment variables
load_dotenv(dotenv_path=os.environ["DDALAB_ENV_FILE"])

os.environ["DDALAB_JWT_SECRET_KEY"] = "test_secret_key_123456789"

# Ensure minimal required env vars for tests if not set
_env_defaults = {
    "DB_USER": "testuser",
    "DB_PASSWORD": "testpass",
    "MINIO_HOST": "localhost:9000",
    "MINIO_ACCESS_KEY": "minio",
    "MINIO_SECRET_KEY": "miniosecret",
    # Allow reading test EDF files under repo data directory by default
    "ALLOWED_DIRS": str(Path(__file__).resolve().parents[3] / "data"),
}
for _k, _v in _env_defaults.items():
    os.environ.setdefault(_k, _v)

if "pytest" in sys.modules:
    from unittest.mock import MagicMock

    import prometheus_client

    prometheus_client.Counter = MagicMock()
    prometheus_client.Histogram = MagicMock()
    prometheus_client.Summary = MagicMock()
    prometheus_client.Gauge = MagicMock()

# Explicitly register dummy services for their abstract/base class in the registry
registry._services[TicketService] = TicketService
registry._services[UserService] = UserService
registry._services[ArtifactService] = ArtifactService
registry._services[StatsService] = StatsService
registry._services[DDAService] = DDAService

db_settings = get_config_service().get_database_settings()
auth_settings = get_config_service().get_auth_settings()
print(f"[DEBUG] Loaded DB URL: {db_settings.connection_url}")

# Use a separate test database
# SQLALCHEMY_DATABASE_URL = (
#     f"postgresql+asyncpg://{db_settings.db_user}:{db_settings.db_password}"
#     f"@{db_settings.db_host}:{db_settings.db_port}/{db_settings.db_name}_test"
# )

# print(f"[DEBUG] Test DB URL: {SQLALCHEMY_DATABASE_URL}")

# Create test app
test_app = FastAPI(title="Test DDALAB API", version="0.1.0")

# Add minimal middleware
test_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
test_app.add_middleware(AuthMiddleware)
test_app.add_middleware(DatabaseMiddleware)

# Include essential routers
test_app.include_router(health_router, prefix="/api/health", tags=["health"])
test_app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
test_app.include_router(tickets_router, prefix="/api/tickets", tags=["tickets"])
test_app.include_router(users_router, prefix="/api/users", tags=["users"])
test_app.include_router(artifacts_router, prefix="/api/artifacts", tags=["artifacts"])
# Include EDF router for EDF API tests
test_app.include_router(edf_router, prefix="/api/edf", tags=["edf"])

# Use test app instead of main app
app = test_app

# Initialize Faker
fake = Faker()

# Test database URL
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="function")
def event_loop():
    """Create a new event loop for each test."""
    import asyncio

    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# Remove or comment out the test_settings fixture and any hardcoded DB config
# (Commenting out for clarity)
# @pytest.fixture
# def test_settings() -> Settings:
#     pass  # No longer needed, config comes from env


@pytest_asyncio.fixture(scope="session")
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
def override_dependencies(test_session, mock_minio_client):
    """Override FastAPI dependencies for testing."""

    def get_test_minio():
        yield mock_minio_client

    # Do NOT override get_db_session; let the app use its own dependency
    app.dependency_overrides[get_minio_client] = get_test_minio

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


@pytest_asyncio.fixture(scope="function")
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
    # Ensure a clean state per test to avoid UNIQUE violations
    await test_session.execute(
        "DELETE FROM users WHERE username = :uname", {"uname": user.username}
    )
    await test_session.commit()
    test_session.add(user)
    await test_session.commit()
    await test_session.refresh(user)
    return user


@pytest_asyncio.fixture(scope="function")
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

    # Use auth_settings from get_config_service()
    auth_settings = get_config_service().get_auth_settings()
    secret = auth_settings.jwt_secret_key
    algorithm = auth_settings.jwt_algorithm
    print(f"[TEST] Creating JWT with secret={secret}, algorithm={algorithm}")
    token = create_jwt_token(
        subject=test_user.username,
        expires_delta=timedelta(minutes=auth_settings.token_expiration_minutes),
        secret_key=secret,
        algorithm=algorithm,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth_headers_admin(test_admin_user):
    """Create authentication headers for admin user."""
    from datetime import timedelta

    from ..core.security import create_jwt_token

    # Use auth_settings from get_config_service()
    auth_settings = get_config_service().get_auth_settings()
    secret = auth_settings.jwt_secret_key
    algorithm = auth_settings.jwt_algorithm
    print(f"[TEST] Creating JWT with secret={secret}, algorithm={algorithm}")
    token = create_jwt_token(
        subject=test_admin_user.username,
        expires_delta=timedelta(minutes=auth_settings.token_expiration_minutes),
        secret_key=secret,
        algorithm=algorithm,
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

    # Mock cache manager unless EDF integration is explicitly enabled
    if os.environ.get("ENABLE_EDF_INTEGRATION", "0") != "1":
        mock_cache = AsyncMock()
        monkeypatch.setattr("core.edf.edf_cache.get_cache_manager", lambda: mock_cache)
        monkeypatch.setattr("core.edf.edf_cache.clear_global_cache", MagicMock())


@pytest.fixture
def test_data_factory():
    """Factory for generating test data dicts for artifacts, tickets, and users."""

    class TestDataFactory:
        def __init__(self, fake):
            self.fake = fake

        def artifact_data(self, name=None, file_path=None, **kwargs):
            return {
                "name": name or self.fake.file_name(extension="jpg"),
                "file_path": file_path
                or f"/tmp/{self.fake.file_name(extension='jpg')}",
                **kwargs,
            }

        def ticket_data(self, title=None, description=None, **kwargs):
            return {
                "title": title or self.fake.sentence(nb_words=4),
                "description": description or self.fake.text(max_nb_chars=50),
                **kwargs,
            }

        def user_data(self, username=None, email=None, password=None, **kwargs):
            return {
                "username": username or self.fake.user_name(),
                "email": email or self.fake.email(),
                "password": password or self.fake.password(),
                **kwargs,
            }

    return TestDataFactory(fake)


@pytest_asyncio.fixture(autouse=True)
async def override_app_db_dependency(test_engine):
    """Override app's get_db_session dependency to yield a new session per test/request."""
    # Use the test app defined above instead of importing main.app
    from sqlalchemy.ext.asyncio import async_sessionmaker

    async_session_maker = async_sessionmaker(bind=test_engine, expire_on_commit=False)

    async def _get_test_db():
        session_id = uuid.uuid4()
        logging.info(f"[TEST] Creating new DB session: {session_id}")
        async with async_session_maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
                logging.info(f"[TEST] Closed DB session: {session_id}")

    # Apply override to the test app instance
    global app
    app.dependency_overrides[get_db_session] = _get_test_db
    yield
    app.dependency_overrides.pop(get_db_session, None)


# Comment out or remove global patching of engine/session to avoid conflicts
# @pytest_asyncio.fixture(autouse=True, scope="session")
# def patch_global_db_engine_and_session(test_engine):
#     """Patch core.database.engine and async_session_maker to use the test engine/session maker."""
#     core.database.engine = test_engine
#     core.database.async_session_maker = async_sessionmaker(
#         test_engine,
#         class_=AsyncSession,
#         expire_on_commit=False,
#         autocommit=False,
#         autoflush=False,
#     )
