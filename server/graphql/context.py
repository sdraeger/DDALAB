"""GraphQL context definitions."""

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from strawberry.fastapi import BaseContext

from ..core.database import get_db


class Context(BaseContext):
    """GraphQL context class."""

    def __init__(self, request: Request, session: AsyncSession):
        super().__init__()
        self.request = request
        self.session = session


async def get_context(
    request: Request,
    session: AsyncSession = Depends(get_db),
) -> Context:
    """Get GraphQL context with request and database session."""
    return Context(request=request, session=session)
