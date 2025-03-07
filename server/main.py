"""Main server application."""

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from server.api import router
from server.core.config import get_server_settings, initialize_config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
        "Server configured with host=%s, port=%d",
        server_settings.host,
        server_settings.port,
    )

    yield  # Server is running

    # Shutdown
    logger.info("Server shutting down...")


# Create FastAPI application
app = FastAPI(
    title="DDALAB API",
    description="API for DDALAB data analysis and visualization",
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

# Include API router
app.include_router(router, prefix="/api")


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
