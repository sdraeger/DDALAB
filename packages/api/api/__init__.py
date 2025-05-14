"""API router initialization."""

from fastapi import APIRouter

from .config import router as config_router
from .dda import router as dda_router
from .edf import router as edf_router
from .favorite_files import router as favorite_files_router
from .files import router as files_router
from .health import router as health_router
from .metrics import router as metrics_router
from .results import router as results_router
from .tickets import router as tickets_router
from .user_preferences import router as user_preferences_router
from .users import router as users_router

# Create router with trailing slash config
router = APIRouter()
router_metrics = APIRouter()

# Include all sub-routers
router.include_router(dda_router, prefix="/dda", tags=["dda"])
router.include_router(files_router, prefix="/files", tags=["files"])
router.include_router(tickets_router, prefix="/tickets", tags=["tickets"])
router.include_router(
    user_preferences_router,
    prefix="/user-preferences",
    tags=["user_preferences"],
)
router.include_router(users_router, prefix="/users", tags=["users"])
router.include_router(health_router, prefix="/health", tags=["health"])
router.include_router(results_router, prefix="/results", tags=["results"])
router.include_router(config_router, prefix="/config", tags=["config"])
router.include_router(
    favorite_files_router, prefix="/favfiles", tags=["favorite_files"]
)
router.include_router(edf_router, prefix="/edf", tags=["edf"])
router_metrics.include_router(metrics_router, prefix="/metrics", tags=["metrics"])
