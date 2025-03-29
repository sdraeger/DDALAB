"""API router initialization."""

from fastapi import APIRouter

from .dda import router as dda_router
from .files import router as files_router
from .health import router as health_router
from .tickets import router as tickets_router
from .user_preferences import router as user_preferences_router
from .users import router as users_router

# Create router with trailing slash config
router = APIRouter()

# Include all sub-routers
router.include_router(dda_router, prefix="/dda", tags=["dda"])
router.include_router(files_router, prefix="/files", tags=["files"])
router.include_router(tickets_router, prefix="/tickets", tags=["tickets"])
router.include_router(
    user_preferences_router,
    prefix="/user-preferences",
    tags=["user_preferences"],
    include_in_schema=True,
)
router.include_router(users_router, prefix="/users", tags=["users"])
router.include_router(health_router, prefix="/health", tags=["health"])
