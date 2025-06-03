"""Main server application."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from minio import Minio
from minio.error import S3Error
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from .api import router as api_router
from .api import router_metrics as api_router_metrics
from .api.auth import router as auth_router
from .core.config import get_server_settings, initialize_config
from .core.middleware import (
    AuthMiddleware,
    DBSessionMiddleware,
    PrometheusMiddleware,
)
from .graphql.graphql import graphql_app

settings = get_server_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application lifespan events.

    This context manager handles startup and shutdown events for the application.
    It's called when the application starts up and shuts down.
    """
    # Startup
    logger.info("Initializing server configuration...")
    initialize_config()
    logger.info("Configuration loaded successfully")

    # Log the current configuration
    server_settings = get_server_settings()
    logger.info(
        "Server configured with host={}, port={}, auth_enabled={}",
        server_settings.api_host,
        server_settings.api_port,
        server_settings.auth_enabled,
    )

    # Initialize EDF cache system
    try:
        from .core.edf.edf_cache import get_cache_manager

        cache_manager = get_cache_manager()
        logger.info("EDF cache system initialized successfully")

        # Log initial cache configuration
        stats = cache_manager.get_cache_stats()
        logger.info(
            f"EDF Cache configured: "
            f"Metadata cache: {stats['metadata_cache']['max_size']} files, "
            f"Chunk cache: {stats['chunk_cache']['max_size_mb']}MB, "
            f"File handles: {stats['file_handles']['max_handles']} max"
        )
    except Exception as e:
        logger.warning(f"Failed to initialize EDF cache system: {e}")

    minio_client = Minio(
        settings.minio_host,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=False,
    )

    try:
        if not minio_client.bucket_exists(settings.minio_bucket_name):
            minio_client.make_bucket(settings.minio_bucket_name)
            logger.info(f"Bucket '{settings.minio_bucket_name}' created.")
            # Set bucket policy to private (default behavior, but explicitly ensure)
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Deny",
                        "Principal": "*",
                        "Action": ["s3:*"],
                        "Resource": [f"arn:aws:s3:::{settings.minio_bucket_name}/*"],
                    }
                ],
            }
            minio_client.set_bucket_policy(
                settings.minio_bucket_name, json.dumps(policy)
            )
            logger.info(
                f"Set private policy for bucket '{settings.minio_bucket_name}'."
            )
    except S3Error as e:
        logger.error(f"Error creating or configuring bucket: {e}")
        raise

    yield  # Server is running

    # Shutdown
    logger.info("Server shutting down...")

    # Clean up cache system
    try:
        from .core.edf.edf_cache import clear_global_cache

        clear_global_cache()
        logger.info("EDF cache system cleaned up")
    except Exception as e:
        logger.warning(f"Error during cache cleanup: {e}")


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

# Add database session middleware
app.add_middleware(DBSessionMiddleware)

# Add Prometheus middleware
app.add_middleware(PrometheusMiddleware)

# Add auth middleware
app.add_middleware(AuthMiddleware)

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
        "*",
    ],
    allow_credentials=False,
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

app_metrics.include_router(api_router_metrics)
