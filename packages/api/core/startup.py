"""Application startup tasks."""

from loguru import logger

from .database import async_session_maker


async def initialize_services():
    """Initialize background services."""
    try:
        # Import here to avoid early import issues
        from .services.notification_service import NotificationService

        # Initialize notification service with session maker for background usage
        notification_service = NotificationService(session_maker=async_session_maker)

        # Start monitoring (this will run in background)
        await notification_service.start_monitoring()

        logger.info("Background services initialized successfully")

    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")


def setup_startup_tasks(app):
    """Setup startup tasks for the FastAPI app."""

    @app.on_event("startup")
    async def startup_event():
        """Run startup tasks."""
        logger.info("Starting application...")
        await initialize_services()
        logger.info("Application startup complete")

    @app.on_event("shutdown")
    async def shutdown_event():
        """Run shutdown tasks."""
        logger.info("Shutting down application...")
        # Cleanup tasks can be added here
        logger.info("Application shutdown complete")
