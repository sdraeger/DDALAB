"""DDA analysis service."""

from pathlib import Path

from core.config import get_server_settings
from core.dda import run_dda
from core.registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ServiceError
from loguru import logger
from schemas.dda import DDARequest, DDAResponse
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class DDAService(BaseService):
    """Service for handling DDA analysis."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.settings = get_server_settings()

    async def analyze(self, request: DDARequest) -> DDAResponse:
        """Perform DDA analysis on the given file."""
        try:
            # Validate file path
            file_path = Path(request.file_path)
            if not (Path(self.settings.data_dir) / file_path).exists():
                raise NotFoundError("File", str(file_path))

            # Convert preprocessing options to dict format expected by run_dda
            preprocessing_options = {}
            if request.preprocessing_options:
                if request.preprocessing_options.filter_low:
                    preprocessing_options["lowpassFilter"] = True
                if request.preprocessing_options.filter_high:
                    preprocessing_options["highpassFilter"] = True
                if request.preprocessing_options.notch_filter:
                    preprocessing_options["notchFilter"] = (
                        request.preprocessing_options.notch_filter
                    )
                if request.preprocessing_options.detrend:
                    preprocessing_options["detrend"] = True
                if request.preprocessing_options.resample:
                    preprocessing_options["resample"] = (
                        request.preprocessing_options.resample
                    )

            # Run DDA analysis using the core implementation
            result = await run_dda(
                file_path=file_path,
                preprocessing_options=preprocessing_options,
            )

            return DDAResponse(**result)

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error performing DDA analysis: {e}")
            raise ServiceError(f"Error performing DDA analysis: {str(e)}")

    @classmethod
    def from_db(cls, db: AsyncSession) -> "DDAService":
        """Create a new instance of the service."""
        return cls(db)
