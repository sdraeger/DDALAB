"""Main server application."""

from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from server.api import router as api_router
from server.api.auth import router as auth_router
from server.core.auth import get_current_user
from server.core.config import get_server_settings, initialize_config
from server.schemas.graphql import graphql_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application lifespan events.

    This context manager handles startup and shutdown events for the application.
    It's called when the application starts up and shuts down.
    """
    # Startup
    logger.info("Initializing server configuration...")
    configs = initialize_config()
    logger.info("Configuration loaded successfully")

    # Log the current configuration
    server_settings = get_server_settings()
    logger.info(
        "Server configured with host={}, port={}, auth_enabled={}",
        server_settings.host,
        server_settings.port,
        server_settings.auth_enabled,
    )

    yield  # Server is running

    # Shutdown
    logger.info("Server shutting down...")


# Create FastAPI application
app = FastAPI(
    title="DDALAB GraphQL API",
    description="GraphQL API for DDALAB data analysis and visualization",
    version="0.1.0",
    lifespan=lifespan,
)


# Add health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "ssl": get_server_settings().ssl_enabled}


# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://localhost:3000",
        "http://localhost:8001",
        "https://localhost:8001",
        "file://",  # Allow Electron app
        "*",  # Allow all origins during development
    ],
    allow_credentials=False,  # Set to False for wildcard origins
    allow_methods=["GET", "POST", "OPTIONS"],  # Allow GET for file downloads
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
    ],
    expose_headers=[
        "Content-Type",
        "Content-Disposition",
        "Content-Length",
    ],  # Expose headers for downloads
    max_age=3600,  # Cache preflight requests for 1 hour
)


# Authentication middleware
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Authentication middleware to check if auth is enabled."""
    settings = get_server_settings()

    # Skip auth for login and OPTIONS requests
    if (
        not settings.auth_enabled
        or request.url.path == "/api/auth/token"
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    # Verify token for all other requests
    try:
        await get_current_user(request)
    except Exception:
        # Let the endpoint handle auth errors
        pass

    return await call_next(request)


# Include GraphQL router
app.include_router(graphql_app, prefix="/graphql")

# Include API routers
app.include_router(api_router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])


def main():
    """Start the server."""
    settings = get_server_settings()
    logger.info("Starting server...")

    ssl_config = None
    if settings.ssl_enabled:
        if not settings.ssl_cert_path or not settings.ssl_key_path:
            logger.error("SSL is enabled but certificate or key path is not set")
            raise ValueError(
                "SSL certificate and key paths must be set when SSL is enabled"
            )
        # Convert relative paths to absolute paths
        base_dir = Path(__file__).parent.parent
        ssl_config = {
            "ssl_keyfile": str(base_dir / settings.ssl_key_path),
            "ssl_certfile": str(base_dir / settings.ssl_cert_path),
            "ssl_version": 2,  # Use TLS 1.2
        }
        logger.info(f"SSL encryption enabled with certificates: {ssl_config}")

    uvicorn.run(
        "server.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,  # Enable auto-reload during development
        ssl_keyfile=ssl_config["ssl_keyfile"] if ssl_config else None,
        ssl_certfile=ssl_config["ssl_certfile"] if ssl_config else None,
        ssl_version=ssl_config["ssl_version"] if ssl_config else None,
    )


if __name__ == "__main__":
    main()
