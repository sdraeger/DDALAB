"""GraphQL context definitions."""

from fastapi import Request
from minio import Minio
from sqlalchemy.ext.asyncio import AsyncSession
from strawberry.fastapi import BaseContext


class Context(BaseContext):
    """GraphQL context class with injected database session and MinIO client."""

    def __init__(self, request: Request):
        super().__init__()
        self.request = request

    @property
    def session(self) -> AsyncSession:
        """Access the database session from request state."""
        return self.request.state.db

    @property
    def minio_client(self) -> Minio:
        """Access the MinIO client from request state."""
        return self.request.state.minio_client


async def get_context(request: Request) -> Context:
    """Get GraphQL context using the middleware-injected session and MinIO client."""
    return Context(request=request)
