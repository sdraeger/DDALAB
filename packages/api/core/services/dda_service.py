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

    async def health_check(self) -> bool:
        """Check if the DDA service is healthy."""
        try:
            # Check if data directory exists and is accessible
            data_dir = Path(self.settings.data_dir)
            if not data_dir.exists():
                logger.error(f"Data directory does not exist: {data_dir}")
                return False

            # Check if data directory is readable
            if not data_dir.is_dir():
                logger.error(f"Data path is not a directory: {data_dir}")
                return False

            # Additional checks could be added here (e.g., check dependencies, modules, etc.)
            return True
        except Exception as e:
            logger.error(f"DDA service health check failed: {e}")
            return False

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

            # Check if the result is already a dict (error response)
            if isinstance(result, dict):
                # If result contains error information, check if it's an error response
                if result.get("error"):
                    logger.error(
                        f"DDA computation failed: {result.get('error_message', 'Unknown error')}"
                    )
                    # Return the error response as-is, but convert to DDAResponse object
                    return DDAResponse(**result)
                else:
                    # Success response, convert to DDAResponse object
                    return DDAResponse(**result)
            else:
                # This shouldn't happen with the updated core function, but handle it
                logger.error(f"Unexpected result type from run_dda: {type(result)}")
                return DDAResponse(
                    file_path=str(file_path),
                    Q=[],
                    preprocessing_options=preprocessing_options,
                    error="UNEXPECTED_RESPONSE",
                    error_message=f"Unexpected response type: {type(result)}",
                )

        except NotFoundError:
            raise
        except Exception as e:
            logger.error(f"Error performing DDA analysis: {e}")
            raise ServiceError(f"Error performing DDA analysis: {str(e)}")

    @classmethod
    def from_db(cls, db: AsyncSession) -> "DDAService":
        """Create a new instance of the service."""
        return cls(db)
