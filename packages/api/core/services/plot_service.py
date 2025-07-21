"""Service for managing plots."""

from typing import List

from loguru import logger

from ..service_registry import register_service
from .base import BaseService
from .plot_cache_service import PlotCacheService


@register_service
class PlotService(BaseService):
    """Service for managing plots."""

    def __init__(self):
        super().__init__(None)  # No database dependency needed
        self.plot_cache_service = PlotCacheService()

    @classmethod
    def from_db(cls, db=None) -> "PlotService":
        """Create a service instance for dependency injection."""
        return cls()

    async def get_user_plots(self, user_id: int) -> List[dict]:
        """
        Get cached plots for a user.

        Args:
            user_id: The user ID

        Returns:
            List of plot data in the format expected by the API
        """
        try:
            # Get cached plots from Redis
            cached_plots = await self.plot_cache_service.get_user_cached_plots(user_id)

            # Convert to the format expected by the API
            plots = []
            for plot_metadata in cached_plots:
                # Get the actual plot data
                plot_data = await self.plot_cache_service.get_cached_plot(
                    user_id=user_id,
                    file_path=plot_metadata["file_path"],
                    plot_params=plot_metadata["plot_params"],
                )

                if plot_data:
                    # Create a unique ID for the plot
                    plot_id = f"plot_{user_id}_{plot_metadata['cache_key']}"

                    # Create artifact info
                    artifact_info = {
                        "artifact_id": plot_id,
                        "name": plot_metadata["file_path"].split("/")[-1],
                        "file_path": plot_metadata["file_path"],
                        "created_at": plot_metadata["cached_at"],
                        "user_id": user_id,
                        "shared_by_user_id": None,
                    }

                    # Create plot response
                    plot = {
                        "id": plot_id,
                        "artifactId": plot_id,
                        "title": f"Plot for {plot_metadata['file_path'].split('/')[-1]}",
                        "data": plot_data,
                        "artifactInfo": artifact_info,
                    }

                    plots.append(plot)

            logger.info(f"Retrieved {len(plots)} plots for user {user_id}")
            return plots

        except Exception as e:
            logger.error(f"Error getting plots for user {user_id}: {e}")
            return []

    async def close(self):
        """Close any open connections."""
        await self.plot_cache_service.close()
