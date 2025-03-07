"""API router initialization."""

from fastapi import APIRouter

from server.signup_handler import router as signup_router

from .dda import router as dda_router
from .files import router as files_router

router = APIRouter()

# Include all sub-routers
router.include_router(dda_router, prefix="/dda", tags=["dda"])
router.include_router(files_router, prefix="/files", tags=["files"])
router.include_router(signup_router)
