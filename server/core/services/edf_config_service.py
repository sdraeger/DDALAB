from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import EdfConfig
from ...schemas.config import EdfConfigUpdate
from ..dependencies import register_service
from ..repository import EdfConfigRepository


@register_service
class EdfConfigService:
    def __init__(self, db: AsyncSession):
        self.repo = EdfConfigRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "EdfConfigService":
        return cls(db)

    async def get_config(
        self, user_id: int | None = None, file_hash: str | None = None
    ) -> EdfConfig | None:
        if user_id is None and file_hash is None:
            raise ValueError("No valid identifier provided")
        if user_id is None:
            return await self.repo.get_by_file_hash(file_hash)
        elif file_hash is None:
            return await self.repo.get_by_user_id(user_id)
        return await self.repo.get_by_user_id_and_file_hash(user_id, file_hash)

    async def update_config(
        self,
        config: EdfConfigUpdate,
        user_id: int | None = None,
        file_hash: str | None = None,
    ) -> EdfConfig | None:
        edf_config = await self.get_config(user_id, file_hash)
        if not edf_config:
            return None
        return await self.repo.update(edf_config, config)
