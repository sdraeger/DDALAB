"""API endpoints for the DDALAB server."""

from fastapi import APIRouter

from .analysis import router as analysis_router
from .files import router as files_router

# Create main API router
api_router = APIRouter()

# Include sub-routers
api_router.include_router(files_router, prefix="/files", tags=["files"])
api_router.include_router(analysis_router, prefix="/analysis", tags=["analysis"])
