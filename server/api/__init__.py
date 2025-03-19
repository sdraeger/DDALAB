"""API router initialization."""

from fastapi import APIRouter

from .dda import router as dda_router
from .files import router as files_router
from .tickets import router as tickets_router

router = APIRouter()

# Include all sub-routers
router.include_router(dda_router, prefix="/dda", tags=["dda"])
router.include_router(files_router, prefix="/files", tags=["files"])
router.include_router(tickets_router, prefix="/tickets", tags=["tickets"])
