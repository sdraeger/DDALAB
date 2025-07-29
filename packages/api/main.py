"""Main server application."""

from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from minio import Minio
from minio.error import S3Error
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from core.config import get_server_settings, initialize_config
from core.middleware import (
    AuthMiddleware,
    DatabaseMiddleware,
    MinIOMiddleware,
    PrometheusMiddleware,
)

# Conditional imports to handle both production and test contexts
try:
    # Try importing from the routes package structure
    from routes import router as api_router
    from routes import router_metrics as api_router_metrics
    from routes.auth import router as auth_router
    from routes.config import router as config_router
    from routes.dashboard import router as dashboard_router
    from routes.user_preferences import router as user_preferences_router

except ImportError as e:
    logger.error(f"Error importing api routers: {e}")
    # Fallback: create dummy routers for test context
    api_router = APIRouter()
    api_router_metrics = APIRouter()
    auth_router = APIRouter()
    config_router = APIRouter()
    dashboard_router = APIRouter()
    user_preferences_router = APIRouter()
    logger.warning("Using fallback routers - some functionality may be limited")

# Import GraphQL router
try:
    from gql.graphql import graphql_app

    logger.info("GraphQL router loaded successfully")
except ImportError as e:
    logger.error(f"Failed to import GraphQL router: {e}")
    # Create a dummy router that returns a 501 Not Implemented
    graphql_router = APIRouter()

    @graphql_router.get("/graphql")
    @graphql_router.post("/graphql")
    async def graphql_not_implemented():
        from fastapi import HTTPException

        raise HTTPException(status_code=501, detail="GraphQL endpoint not available")

    graphql_app = graphql_router
    logger.warning("Using fallback GraphQL router - endpoint will return 501")

settings = get_server_settings()


async def _ensure_minio_bucket_exists():
    """Ensure the MinIO bucket exists."""
    try:
        print("MinIO host:", settings.minio_host)
        print("MinIO access key:", settings.minio_access_key)
        print("MinIO secret key:", settings.minio_secret_key)
        print("MinIO bucket name:", settings.minio_bucket_name)

        minio_client = Minio(
            settings.minio_host,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )

        bucket_name = settings.minio_bucket_name
        if not minio_client.bucket_exists(bucket_name):
            minio_client.make_bucket(bucket_name)
            logger.info(f"Created MinIO bucket: {bucket_name}")
        else:
            logger.info(f"MinIO bucket already exists: {bucket_name}")

    except S3Error as e:
        logger.error(f"Failed to create/check MinIO bucket: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error with MinIO: {e}")
        raise


async def _initialize_local_mode():
    """Initialize local mode by ensuring the default user exists."""
    if settings.auth_mode != "local":
        logger.debug("Not in local mode, skipping local user initialization")
        return

    logger.info("Initializing local mode...")

    try:
        from core.database import async_session_maker
        from core.services.local_user_service import LocalUserService

        async with async_session_maker() as session:
            local_user_service = LocalUserService(session)
            default_user = await local_user_service.ensure_default_user_exists()
            await session.commit()

            logger.info(
                f"Local mode initialized with default user: '{default_user.username}' "
                f"(ID: {default_user.id}, Admin: {default_user.is_admin})"
            )
    except Exception as e:
        logger.error(f"Failed to initialize local mode: {e}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app."""
    try:
        logger.info("Starting up DDALAB API server...")

        # Initialize configurations
        configs = initialize_config()
        logger.info(f"Initialized configurations: {list(configs.keys())}")
        logger.info(f"Auth mode: {settings.auth_mode}")

        # Check MinIO bucket
        await _ensure_minio_bucket_exists()

        # Initialize local mode if needed
        await _initialize_local_mode()

        logger.info("DDALAB API server startup complete!")

        yield

    except Exception as e:
        logger.error(f"Failed to start DDALAB API server: {e}")
        raise
    finally:
        logger.info("Shutting down DDALAB API server...")
        logger.info("DDALAB API server shutdown complete!")


# Create FastAPI application
app = FastAPI(
    title="DDALAB GraphQL API",
    description="GraphQL API for DDALAB data analysis and visualization",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app_metrics = FastAPI(
    title="DDALAB Metrics API",
    description="Metrics endpoint for Prometheus",
    version="0.1.0",
)

# Set up OpenTelemetry tracer provider with service name
trace.set_tracer_provider(
    TracerProvider(resource=Resource.create({"service.name": "ddalab-api"}))
)

# Use OTLP HTTP exporter instead of UDP to avoid packet size limitations
try:
    otlp_exporter = OTLPSpanExporter(
        endpoint=f"http://{settings.otlp_host}:4318/v1/traces",
    )
    span_processor = BatchSpanProcessor(
        otlp_exporter,
        # Configure batch processing to handle large spans better
        max_queue_size=2048,
        max_export_batch_size=512,
        export_timeout_millis=30000,
    )
    trace.get_tracer_provider().add_span_processor(span_processor)
    logger.info(f"OTLP tracing configured for {settings.otlp_host}:4318")
except Exception as e:
    logger.warning(f"Failed to configure OTLP tracing: {e}. Tracing will be disabled.")

# Add Prometheus middleware (executed first due to LIFO order)
app.add_middleware(PrometheusMiddleware)

# Add MinIO middleware
app.add_middleware(MinIOMiddleware)

# Add auth middleware (executed before database middleware due to LIFO order)
app.add_middleware(AuthMiddleware)

# Add database middleware (executed last, so it runs first in the chain)
app.add_middleware(DatabaseMiddleware)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://localhost:3000",
        "http://localhost:8001",
        "https://localhost:8001",
        "http://localhost",
        "https://localhost",
        "file://",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Type",
        "Content-Disposition",
        "Content-Length",
    ],
    max_age=3600,
)

# Include GraphQL router
app.include_router(graphql_app, prefix="/graphql")

# Include API routers
app.include_router(api_router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(config_router, prefix="/api/config", tags=["config"])
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(
    user_preferences_router, prefix="/api/user-preferences", tags=["user-preferences"]
)

app_metrics.include_router(api_router_metrics)
