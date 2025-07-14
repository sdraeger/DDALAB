"""GraphQL context definitions."""

from core.database import async_session_maker
from fastapi import Request
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession
from strawberry.fastapi import BaseContext


class Context(BaseContext):
    """GraphQL context class with injected database session and MinIO client."""

    def __init__(self, request: Request):
        super().__init__()
        self.request = request
        self._db = None

    @property
    async def session(self) -> AsyncSession:
        """Access the database session from request state or create a new one."""
        if hasattr(self.request.state, "db"):
            return self.request.state.db

        if self._db is None:
            self._db = async_session_maker()
        return self._db

    @property
    def minio_client(self) -> Minio:
        """Access the MinIO client from request state."""
        if not hasattr(self.request.state, "minio_client"):
            raise RuntimeError("MinIO client not found in request state")
        return self.request.state.minio_client


async def get_context(request: Request) -> Context:
    """Get GraphQL context using the middleware-injected session and MinIO client."""
    return Context(request=request)
