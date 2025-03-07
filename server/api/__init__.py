"""API endpoints for the DDALAB server."""

from fastapi import APIRouter

from .analysis import router as analysis_router
from .files import router as files_router

# Create main API router
router = APIRouter()

# Include sub-routers
router.include_router(files_router, prefix="/files", tags=["files"])
router.include_router(analysis_router, prefix="/analysis", tags=["analysis"])
