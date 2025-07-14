"""FastAPI middleware."""

from core.auth import is_user_logged_in
from core.config import get_server_settings
from core.database import async_session_maker
from fastapi import Request, Response
from minio import Minio
from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.types import ASGIApp

settings = get_server_settings()

# Prometheus metrics
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total count of HTTP requests",
    ["method", "endpoint", "status"],
)
REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "endpoint"],
)


class DatabaseMiddleware(BaseHTTPMiddleware):
    """Middleware to inject database session into request state."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Inject database session into request state."""
        async with async_session_maker() as session:
            request.state.db = session
            try:
                response = await call_next(request)
                await session.commit()
                return response
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()


class MinIOMiddleware(BaseHTTPMiddleware):
    """Middleware to inject MinIO client into request state."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Inject MinIO client into request state."""
        request.state.minio_client = Minio(
            settings.minio_host,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=False,
        )
        return await call_next(request)


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware to handle authentication."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Handle authentication."""
        # Skip auth for certain paths
        if not settings.auth_enabled or _should_skip_auth(request.url.path):
            return await call_next(request)

        # Extract token from Authorization header
        auth_header = request.headers.get("authorization", "")
        token = auth_header.replace("Bearer ", "").strip()

        # Store token in request state
        request.state.token = token

        # Check if user is logged in
        if not is_user_logged_in(request):
            from fastapi import HTTPException

            raise HTTPException(status_code=401, detail="Authentication required")

        return await call_next(request)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Middleware to collect Prometheus metrics."""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        """Collect Prometheus metrics."""
        import time

        method = request.method
        path = request.url.path

        # Start timer
        start_time = time.time()

        # Process request
        response = await call_next(request)

        # Record metrics
        REQUEST_COUNT.labels(
            method=method, endpoint=path, status=response.status_code
        ).inc()
        REQUEST_LATENCY.labels(method=method, endpoint=path).observe(
            time.time() - start_time
        )

        return response


def _should_skip_auth(path: str) -> bool:
    """Check if authentication should be skipped for the given path."""
    skip_paths = [
        "/api/auth/token",  # Login endpoint
        "/api/auth/register",  # Registration endpoint
        "/api/auth/reset-password",  # Password reset endpoint
        "/api/auth/verify-reset-token",  # Password reset token verification
        "/metrics",  # Prometheus metrics endpoint
        "/docs",  # API documentation
        "/redoc",  # API documentation
        "/openapi.json",  # OpenAPI schema
        "/graphql",  # GraphQL endpoint
    ]
    return any(path.startswith(skip_path) for skip_path in skip_paths)
