import time

from fastapi import HTTPException, Request
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from ..api.metrics import REQUEST_COUNT, REQUEST_LATENCY
from .dependencies import get_db


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
            raise HTTPException(status_code=401, detail="Authentication required")

        # Split "Bearer <token>" to get the token
        try:
            scheme, token = auth_header.split()
            if scheme.lower() != "bearer" or not token:
                raise ValueError
        except ValueError:
            logger.error("Invalid Authorization header format")
            raise HTTPException(status_code=401, detail="Invalid authentication scheme")

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


class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        logger.info("Prometheus middleware")

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
