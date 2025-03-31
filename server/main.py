"""Main server application."""

from contextlib import asynccontextmanager

# from pathlib import Path
# import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from minio import Minio
from minio.error import S3Error

from server.api import router as api_router
from server.api import router_metrics as api_router_metrics
from server.api.auth import router as auth_router
from server.core.config import get_server_settings, initialize_config
from server.core.middleware import (
    AuthMiddleware,
    DBSessionMiddleware,
    PrometheusMiddleware,
)
from server.schemas.graphql import graphql_app

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
    except S3Error as e:
        logger.error(f"Error creating bucket: {e}")

    yield  # Server is running

    # Shutdown
    logger.info("Server shutting down...")


# Create FastAPI application
app = FastAPI(
    title="DDALAB GraphQL API",
    description="GraphQL API for DDALAB data analysis and visualization",
    version="0.1.0",
    lifespan=lifespan,
    # Configure trailing slash behavior
    redirect_slashes=False,
)
app_metrics = FastAPI(
    title="DDALAB Metrics API",
    description="Metrics endpoint for Prometheus",
    version="0.1.0",
)

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
        "file://",  # Allow Electron app
        "*",  # Allow all origins during development
    ],
    allow_credentials=False,  # Set to False for wildcard origins
    allow_methods=["*"],  # Allow all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allow all headers (Authorization, etc.)
    expose_headers=[
        "Content-Type",
        "Content-Disposition",
        "Content-Length",
    ],  # Expose headers for downloads
    max_age=3600,  # Cache preflight requests for 1 hour
)

# Include GraphQL router
app.include_router(graphql_app, prefix="/graphql")

# Include API routers
app.include_router(api_router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

app_metrics.include_router(api_router_metrics)


# def main():
#     """Start the server."""
#     logger.info("Starting server...")

#     ssl_config = {}

#     if settings.ssl_enabled:
#         if not (settings.ssl_cert_path and settings.ssl_key_path):
#             logger.error("SSL is enabled but certificate or key path is not set")
#             raise ValueError(
#                 "SSL certificate and key paths must be set when SSL is enabled"
#             )

#         # Convert relative paths to absolute paths
#         base_dir = Path(__file__).parent.parent
#         ssl_config = {
#             "ssl_keyfile": str(base_dir / settings.ssl_key_path),
#             "ssl_certfile": str(base_dir / settings.ssl_cert_path),
#             "ssl_version": 2,  # Use TLS 1.2
#         }
#         logger.info(f"SSL encryption enabled with certificates: {ssl_config}")

#     kwargs = {
#         "host": settings.api_host,
#         "port": settings.api_port,
#         "reload": settings.reload,
#         **ssl_config,
#     }
#     uvicorn.run("server.main:app", **kwargs)


# if __name__ == "__main__":
#     main()
