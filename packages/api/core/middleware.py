"""Custom middleware for the FastAPI application."""

import time

from fastapi import Request
from fastapi.responses import JSONResponse
from loguru import logger
from minio import Minio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from .config import get_server_settings

# Conditional import for metrics
try:
    from routes.metrics import REQUEST_COUNT, REQUEST_LATENCY
except ImportError:
    # Create mock metrics for test context
    from unittest.mock import MagicMock

    REQUEST_COUNT = MagicMock()
    REQUEST_LATENCY = MagicMock()
    logger.warning("Using mock metrics - prometheus metrics not available")

from .dependencies import get_db

settings = get_server_settings()


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip authentication for specific routes
        if request.url.path in [
            "/login",
            "/docs",
            "/openapi.json",
            "/api/health",
            "/api/config",
            "/api/auth/token",
            "/api/auth/login",
            "/api/auth/refresh-token",
        ]:
            logger.info(f"Skipping authentication for route: {request.url.path}")
            return await call_next(request)

        logger.info(f"Request: {request}")

        # Extract token from Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            logger.error("No Authorization header provided")
            return JSONResponse(
                status_code=401, content={"detail": "Authentication required"}
            )

        # Split "Bearer <token>" to get the token
        try:
            scheme, token = auth_header.split()
            if scheme.lower() != "bearer" or not token:
                raise ValueError
        except ValueError:
            logger.error("Invalid Authorization header format")
            return JSONResponse(
                status_code=401, content={"detail": "Invalid authentication scheme"}
            )

        # Add token to request state for use in dependencies
        request.state.token = token

        # Proceed with the request
        response = await call_next(request)
        return response


class DBSessionMiddleware(BaseHTTPMiddleware):
    """Middleware to ensure database sessions are properly closed."""

    async def dispatch(self, request: Request, call_next):
        """Handle database session cleanup."""

        async with get_db() as db:
            request.state.db = db
            try:
                response = await call_next(request)
                await db.commit()
                return response
            except Exception:
                await db.rollback()
                raise


class MinIOMiddleware(BaseHTTPMiddleware):
    """Middleware to inject MinIO client into request state."""

    def __init__(self, app):
        super().__init__(app)
        self.minio_client = None

    def _create_minio_client(self) -> Minio:
        """Create a MinIO client instance."""
        if not self.minio_client:
            self.minio_client = Minio(
                settings.minio_host,
                access_key=settings.minio_access_key,
                secret_key=settings.minio_secret_key,
                secure=False,
            )
        return self.minio_client

    async def dispatch(self, request: Request, call_next):
        """Inject MinIO client into request state."""
        request.state.minio_client = self._create_minio_client()

        try:
            response = await call_next(request)
            return response
        except Exception:
            raise


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        # Record start time
        start_time = time.time()

        # Process the request and get the response
        response = await call_next(request)

        # Calculate duration
        duration = time.time() - start_time

        # Record metrics
        REQUEST_COUNT.labels(
            method=request.method, path=request.url.path, status=response.status_code
        ).inc()

        REQUEST_LATENCY.labels(path=request.url.path).observe(duration)

        return response
