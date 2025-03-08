"""Main server application."""

from contextlib import asynccontextmanager

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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    uvicorn.run(
        "server.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,  # Enable auto-reload during development
    )


if __name__ == "__main__":
    main()
