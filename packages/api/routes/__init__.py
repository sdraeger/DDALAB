"""API router initialization."""

from fastapi import APIRouter
from prometheus_client import generate_latest

from .artifacts import router as artifacts_router
from .config import router as config_router
from .dashboard import router as dashboard_router
from .dda import router as dda_router
from .edf import router as edf_router
from .favorite_files import router as favorite_files_router
from .files import router as files_router
from .health import router as health_router
from .layouts import router as layouts_router
from .metrics import router as metrics_router
from .tickets import router as tickets_router
from .user_preferences import router as user_preferences_router
from .users import router as users_router
from .widget_layouts import router as widget_layouts_router

# Create router with trailing slash config
router = APIRouter()
router_metrics = APIRouter()

# Include all sub-routers
router.include_router(artifacts_router, prefix="/artifacts", tags=["artifacts"])
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
router.include_router(config_router, prefix="/config", tags=["config"])
router.include_router(
    favorite_files_router, prefix="/favfiles", tags=["favorite_files"]
)
router.include_router(edf_router, prefix="/edf", tags=["edf"])
router_metrics.include_router(metrics_router, prefix="/metrics", tags=["metrics"])
router.include_router(layouts_router, prefix="/layouts", tags=["layouts"])
router.include_router(
    widget_layouts_router, prefix="/widget-layouts", tags=["widget-layouts"]
)
router.include_router(dashboard_router, prefix="/dashboard", tags=["dashboard"])


def include_routers(app):
    """Include routers in the FastAPI app - deprecated function, routers are included directly."""
    pass


@router_metrics.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    return generate_latest().decode()
