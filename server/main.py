"""DDALAB Server main application."""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import api_router
from .config import get_settings

# Create FastAPI application
app = FastAPI(
    title="DDALAB Server",
    description="FastAPI backend for DDALAB",
    version="0.1.0",
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
app.include_router(api_router, prefix="/api")


def main():
    """Run the server."""
    settings = get_settings()
    uvicorn.run(
        "server.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,  # Enable auto-reload during development
    )


if __name__ == "__main__":
    main()
