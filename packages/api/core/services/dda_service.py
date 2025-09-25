"""DDA service."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

from core.environment import get_config_service
from core.dda import run_dda
from core.registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ServiceError
from core.services.dda_variant_service import DDAVariantService, DDAVariant
from core.services.widget_data_service import WidgetDataService
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

    async def get_analysis_history(
        self, 
        user_id: int, 
        file_path: Optional[str] = None, 
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get DDA analysis history for a user."""
        try:
            # Use widget data service to retrieve stored DDA results
            widget_data_service = WidgetDataService(self.db)
            
            # Create a key pattern to search for DDA results
            key_pattern = "dda_result:"
            if file_path:
                # If file_path is specified, we could filter results by file_path
                # For now, we'll get all results and filter in Python
                pass
            
            # Get all DDA result keys for this user (this is a simplified approach)
            # In a production system, you might want a more efficient querying mechanism
            history = []
            
            # Since widget data service doesn't have a "list all keys" method,
            # we'll use a different approach - store a master list of DDA results
            master_key = f"dda_history_master:{user_id}"
            
            try:
                master_data = await widget_data_service.get_widget_data(user_id, master_key)
                if master_data and master_data.get("data") and "result_ids" in master_data["data"]:
                    result_ids = master_data["data"]["result_ids"][-limit:]  # Get latest results
                    
                    for result_id in reversed(result_ids):  # Most recent first
                        try:
                            result_key = f"dda_result:{result_id}"
                            result_response = await widget_data_service.get_widget_data(user_id, result_key)
                            if result_response and result_response.get("data"):
                                result_data = result_response["data"]
                                # Filter by file_path if specified
                                if not file_path or result_data.get("file_path") == file_path:
                                    history.append(result_data)
                        except Exception as e:
                            logger.warning(f"Failed to load DDA result {result_id}: {e}")
                            continue
                            
            except Exception as e:
                logger.info(f"No DDA history master found for user {user_id}: {e}")
                # No history yet, return empty list
                pass
                
            return history[:limit]  # Ensure we don't exceed limit
            
        except Exception as e:
            logger.error(f"Error getting DDA analysis history: {e}")
            raise ServiceError(f"Failed to get analysis history: {str(e)}")

    async def save_analysis_history(
        self, 
        user_id: int, 
        history_entry: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Save a DDA analysis result to history."""
        try:
            # Use widget data service to store the result
            widget_data_service = WidgetDataService(self.db)
            
            # Generate a unique ID for this result if not provided
            if "id" not in history_entry:
                history_entry["id"] = f"dda_{uuid.uuid4().hex[:12]}"
            
            # Add timestamp if not provided
            if "created_at" not in history_entry:
                history_entry["created_at"] = datetime.utcnow().isoformat()
            
            # Store the result
            result_key = f"dda_result:{history_entry['id']}"
            await widget_data_service.store_widget_data(
                user_id=user_id,
                data_key=result_key,
                widget_data=history_entry,
                widget_id="dda-analysis",
                metadata={
                    "type": "dda-result",
                    "file_path": history_entry.get("file_path"),
                    "created_at": history_entry["created_at"]
                }
            )
            
            # Update the master list of DDA results
            master_key = f"dda_history_master:{user_id}"
            try:
                master_response = await widget_data_service.get_widget_data(user_id, master_key)
                if not master_response or not master_response.get("data"):
                    master_data = {"result_ids": []}
                else:
                    master_data = master_response["data"]
                
                # Add the new result ID to the list
                if "result_ids" not in master_data:
                    master_data["result_ids"] = []
                
                # Add to the beginning (most recent first)
                if history_entry["id"] not in master_data["result_ids"]:
                    master_data["result_ids"].append(history_entry["id"])
                
                # Keep only the latest 100 results to avoid unbounded growth
                master_data["result_ids"] = master_data["result_ids"][-100:]
                
                # Save the updated master list
                await widget_data_service.store_widget_data(
                    user_id=user_id,
                    data_key=master_key,
                    widget_data=master_data,
                    widget_id="dda-analysis",
                    metadata={"type": "dda-history-master"}
                )
                
            except Exception as e:
                logger.warning(f"Failed to update DDA history master list: {e}")
                # Continue anyway - the result is still saved
            
            logger.info(f"Successfully saved DDA result {history_entry['id']} for user {user_id}")
            return history_entry
            
        except Exception as e:
            logger.error(f"Error saving DDA analysis history: {e}")
            raise ServiceError(f"Failed to save analysis history: {str(e)}")

    async def get_analysis_by_id(
        self, 
        user_id: int, 
        result_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a specific DDA analysis result by its ID."""
        try:
            # Use widget data service to retrieve the specific result
            widget_data_service = WidgetDataService(self.db)
            
            # Construct the key for the specific result
            result_key = f"dda_result:{result_id}"
            
            # Get the result data
            result_response = await widget_data_service.get_widget_data(user_id, result_key)
            
            if not result_response or not result_response.get("data"):
                logger.info(f"No DDA analysis found with ID {result_id} for user {user_id}")
                return None
            
            result_data = result_response["data"]
            logger.info(f"Successfully retrieved DDA analysis {result_id} for user {user_id}")
            return result_data
            
        except Exception as e:
            logger.error(f"Error getting DDA analysis by ID: {e}")
            raise ServiceError(f"Failed to get analysis by ID: {str(e)}")
