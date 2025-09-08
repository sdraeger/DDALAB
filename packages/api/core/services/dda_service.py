"""DDA service."""

from pathlib import Path
from typing import List

from core.environment import get_config_service
from core.dda import run_dda
from core.registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ServiceError
from core.services.dda_variant_service import DDAVariantService, DDAVariant
from loguru import logger
from schemas.dda import DDARequest, DDAResponse
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class DDAService(BaseService):
    """Service for handling DDA."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.storage_settings = get_config_service().get_storage_settings()

    async def health_check(self) -> bool:
        """Check if the DDA service is healthy."""
        try:
            # Check if data directory exists and is accessible
            data_dir = Path(self.storage_settings.data_dir)
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
        """Perform DDA on the given file."""
        try:
            # Validate file path
            logger.info(f"DDA service received file_path: {request.file_path}")
            file_path = Path(request.file_path)

            # First, try to resolve the path as provided
            try:
                resolved_path = file_path.resolve()
                if resolved_path.exists():
                    logger.info(f"DDA service: Using resolved path as-is: {resolved_path}")
                    file_path = resolved_path
                else:
                    # If the path doesn't exist as provided, check if it needs data_dir prepended
                    # This handles cases where the frontend sends just "edf/file.edf"
                    if not file_path.is_absolute() and not str(file_path).startswith('..'):
                        full_path = Path(self.storage_settings.data_dir) / file_path
                        resolved_full_path = full_path.resolve()
                        if resolved_full_path.exists():
                            logger.info(f"DDA service: Using path relative to data_dir: {file_path} -> {resolved_full_path}")
                            file_path = resolved_full_path
                        else:
                            raise NotFoundError("File", str(request.file_path))
                    else:
                        raise NotFoundError("File", str(request.file_path))
            except Exception as e:
                logger.error(f"Error resolving file path: {e}")
                raise NotFoundError("File", str(request.file_path))

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

            # Convert algorithm selection to dict format expected by run_dda
            algorithm_selection = None
            if request.algorithm_selection:
                algorithm_selection = {
                    "enabled_variants": request.algorithm_selection.enabled_variants
                }

            # Run DDA using the core implementation, pass channel_list if provided
            logger.info(f"DDA service calling run_dda with file_path: {file_path}")
            result = await run_dda(
                file_path=file_path,
                channel_list=request.channel_list
                if hasattr(request, "channel_list")
                else None,
                preprocessing_options=preprocessing_options,
                algorithm_selection=algorithm_selection,
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
            logger.error(f"Error performing DDA: {e}")
            raise ServiceError(f"Error performing DDA: {str(e)}")

    async def get_available_variants(self) -> List[DDAVariant]:
        """Get available DDA algorithm variants."""
        try:
            variant_service = DDAVariantService()
            return variant_service.get_available_variants()
        except Exception as e:
            logger.error(f"Error getting available variants: {e}")
            raise ServiceError(f"Error getting available variants: {str(e)}")

    @classmethod
    def from_db(cls, db: AsyncSession) -> "DDAService":
        """Create a new instance of the service."""
        return cls(db)
