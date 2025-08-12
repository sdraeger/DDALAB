"""Plot caching service using Redis."""

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger

from ..environment import get_config_service
from ..service_registry import register_service
from .base import BaseService
from .redis_service import RedisService


@register_service
class PlotCacheService(BaseService):
    """Service for caching plot data in Redis."""

    def __init__(self):
        super().__init__(None)  # No database dependency needed
        self.cache_settings = get_config_service().get_cache_settings()
        self.redis_service = RedisService(
            host=self.cache_settings.redis_host,
            port=self.cache_settings.redis_port,
            db=self.cache_settings.redis_db,
            password=self.cache_settings.redis_password,
            use_ssl=self.cache_settings.redis_use_ssl,
        )

    @classmethod
    def from_db(cls, db=None) -> "PlotCacheService":
        """Create a service instance for dependency injection."""
        return cls()

    def _generate_cache_key(
        self, user_id: int, file_path: str, plot_params: Dict[str, Any]
    ) -> str:
        """Generate a unique cache key for plot data."""
        # Create a hash of the plot parameters to ensure uniqueness
        params_hash = hashlib.md5(
            json.dumps(plot_params, sort_keys=True).encode()
        ).hexdigest()

        # Create a safe file path hash
        file_path_hash = hashlib.md5(file_path.encode()).hexdigest()

        cache_key = (
            f"plot_cache:user:{user_id}:file:{file_path_hash}:params:{params_hash}"
        )
        logger.debug(f"[PlotCacheService] Generated cache key: {cache_key}")
        logger.debug(
            f"[PlotCacheService] Cache key components - user_id: {user_id}, file_path: {file_path}, params_hash: {params_hash}"
        )
        return cache_key

    def _generate_user_plots_key(self, user_id: int) -> str:
        """Generate a key for storing user's plot cache metadata."""
        user_plots_key = f"plot_cache:user:{user_id}:plots"
        logger.debug(f"[PlotCacheService] Generated user plots key: {user_plots_key}")
        return user_plots_key

    async def cache_plot(
        self,
        user_id: int,
        file_path: str,
        plot_params: Dict[str, Any],
        plot_data: Dict[str, Any],
        ttl: Optional[int] = None,
    ) -> bool:
        """
        Cache plot data for a user.

        Args:
            user_id: The user ID
            file_path: The file path
            plot_params: Plot parameters (chunk_start, chunk_size, preprocessing_options, etc.)
            plot_data: The actual plot data to cache
            ttl: Time to live in seconds (uses default from settings if None)

        Returns:
            True if successful, False otherwise
        """
        logger.info(
            f"[PlotCacheService] Starting cache_plot for user {user_id}, file {file_path}"
        )
        logger.debug(f"[PlotCacheService] Plot params: {plot_params}")
        logger.debug(
            f"[PlotCacheService] Plot data keys: {list(plot_data.keys()) if plot_data else 'None'}"
        )

        try:
            cache_key = self._generate_cache_key(user_id, file_path, plot_params)
            user_plots_key = self._generate_user_plots_key(user_id)

            # Use default TTL if not specified
            if ttl is None:
                ttl = self.cache_settings.plot_cache_ttl
                logger.debug(f"[PlotCacheService] Using default TTL: {ttl}s")
            else:
                logger.debug(f"[PlotCacheService] Using provided TTL: {ttl}s")

            # Cache the plot data
            logger.debug(f"[PlotCacheService] Caching plot data with key: {cache_key}")
            success = await self.redis_service.set(cache_key, plot_data, ttl)
            if not success:
                logger.error(
                    f"[PlotCacheService] Failed to cache plot data for user {user_id}, file {file_path}"
                )
                return False

            # Store metadata about this cached plot
            plot_metadata = {
                "cache_key": cache_key,
                "file_path": file_path,
                "plot_params": plot_params,
                "cached_at": datetime.utcnow().isoformat(),
                "ttl": ttl,
            }

            logger.debug(f"[PlotCacheService] Storing plot metadata: {plot_metadata}")

            # Get existing user plots metadata
            user_plots = await self.redis_service.get_json(user_plots_key) or {}
            logger.debug(
                f"[PlotCacheService] Existing user plots count: {len(user_plots)}"
            )

            # Add or update the plot metadata
            user_plots[cache_key] = plot_metadata

            # Store updated user plots metadata
            await self.redis_service.set_json(user_plots_key, user_plots, ttl)

            logger.info(
                f"[PlotCacheService] Successfully cached plot for user {user_id}, file {file_path}, key: {cache_key}"
            )
            logger.debug(
                f"[PlotCacheService] Total cached plots for user {user_id}: {len(user_plots)}"
            )
            return True

        except Exception as e:
            logger.error(
                f"[PlotCacheService] Error caching plot for user {user_id}, file {file_path}: {e}"
            )
            return False

    async def get_cached_plot(
        self, user_id: int, file_path: str, plot_params: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached plot data for a user.

        Args:
            user_id: The user ID
            file_path: The file path
            plot_params: Plot parameters (chunk_start, chunk_size, preprocessing_options, etc.)

        Returns:
            Cached plot data if found, None otherwise
        """
        logger.info(
            f"[PlotCacheService] Starting get_cached_plot for user {user_id}, file {file_path}"
        )
        logger.debug(f"[PlotCacheService] Plot params: {plot_params}")

        try:
            cache_key = self._generate_cache_key(user_id, file_path, plot_params)
            logger.debug(f"[PlotCacheService] Looking for cache key: {cache_key}")

            # Check if the cached plot exists
            exists = await self.redis_service.exists(cache_key)
            if not exists:
                logger.info(
                    f"[PlotCacheService] No cached plot found for user {user_id}, file {file_path}"
                )
                return None

            # Get the cached plot data
            logger.debug("[PlotCacheService] Cached plot exists, retrieving data...")
            plot_data = await self.redis_service.get(cache_key)
            if plot_data is None:
                logger.warning(
                    f"[PlotCacheService] Failed to retrieve cached plot data for key: {cache_key}"
                )
                return None

            logger.info(
                f"[PlotCacheService] Successfully retrieved cached plot for user {user_id}, file {file_path}"
            )
            logger.debug(
                f"[PlotCacheService] Retrieved plot data keys: {list(plot_data.keys()) if plot_data else 'None'}"
            )
            return plot_data

        except Exception as e:
            logger.error(
                f"[PlotCacheService] Error retrieving cached plot for user {user_id}, file {file_path}: {e}"
            )
            return None

    async def get_user_cached_plots(self, user_id: int) -> List[Dict[str, Any]]:
        """
        Get all cached plots for a user.

        Args:
            user_id: The user ID

        Returns:
            List of cached plot metadata
        """
        logger.info(
            f"[PlotCacheService] Starting get_user_cached_plots for user {user_id}"
        )

        try:
            user_plots_key = self._generate_user_plots_key(user_id)
            logger.debug(
                f"[PlotCacheService] Getting user plots from key: {user_plots_key}"
            )

            user_plots = await self.redis_service.get_json(user_plots_key) or {}
            logger.debug(
                f"[PlotCacheService] Found {len(user_plots)} cached plots for user {user_id}"
            )

            # Filter out expired plots
            valid_plots = []
            expired_count = 0

            for cache_key, plot_metadata in user_plots.items():
                logger.debug(f"[PlotCacheService] Checking plot: {cache_key}")
                exists = await self.redis_service.exists(cache_key)
                if exists:
                    valid_plots.append(plot_metadata)
                    logger.debug(f"[PlotCacheService] Plot is valid: {cache_key}")
                else:
                    # Remove expired plot from metadata
                    logger.debug(f"[PlotCacheService] Plot has expired: {cache_key}")
                    del user_plots[cache_key]
                    expired_count += 1

            # Update user plots metadata if any expired plots were removed
            if expired_count > 0:
                logger.info(
                    f"[PlotCacheService] Removed {expired_count} expired plots for user {user_id}"
                )
                await self.redis_service.set_json(user_plots_key, user_plots)

            logger.info(
                f"[PlotCacheService] Retrieved {len(valid_plots)} valid cached plots for user {user_id}"
            )
            for plot in valid_plots:
                logger.debug(
                    f"[PlotCacheService] Valid plot: {plot.get('file_path', 'unknown')} - {plot.get('cached_at', 'unknown')}"
                )

            return valid_plots

        except Exception as e:
            logger.error(
                f"[PlotCacheService] Error retrieving cached plots for user {user_id}: {e}"
            )
            return []

    async def delete_cached_plot(
        self, user_id: int, file_path: str, plot_params: Dict[str, Any]
    ) -> bool:
        """
        Delete a specific cached plot.

        Args:
            user_id: The user ID
            file_path: The file path
            plot_params: Plot parameters

        Returns:
            True if successful, False otherwise
        """
        try:
            cache_key = self._generate_cache_key(user_id, file_path, plot_params)
            user_plots_key = self._generate_user_plots_key(user_id)

            # Delete the cached plot data
            success = await self.redis_service.delete(cache_key)

            # Remove from user plots metadata
            user_plots = await self.redis_service.get_json(user_plots_key) or {}
            if cache_key in user_plots:
                del user_plots[cache_key]
                await self.redis_service.set_json(user_plots_key, user_plots)

            if success:
                logger.info(f"Deleted cached plot for user {user_id}, file {file_path}")
            else:
                logger.warning(
                    f"No cached plot found to delete for user {user_id}, file {file_path}"
                )

            return success

        except Exception as e:
            logger.error(
                f"Error deleting cached plot for user {user_id}, file {file_path}: {e}"
            )
            return False

    async def delete_user_plots(self, user_id: int) -> bool:
        """
        Delete all cached plots for a user.

        Args:
            user_id: The user ID

        Returns:
            True if successful, False otherwise
        """
        try:
            user_plots_key = self._generate_user_plots_key(user_id)
            user_plots = await self.redis_service.get_json(user_plots_key) or {}

            # Delete all cached plot data
            deleted_count = 0
            for cache_key in user_plots.keys():
                if await self.redis_service.delete(cache_key):
                    deleted_count += 1

            # Delete user plots metadata
            await self.redis_service.delete(user_plots_key)

            logger.info(f"Deleted {deleted_count} cached plots for user {user_id}")
            return True

        except Exception as e:
            logger.error(f"Error deleting cached plots for user {user_id}: {e}")
            return False

    async def delete_file_plots(self, user_id: int, file_path: str) -> bool:
        """
        Delete all cached plots for a specific file.

        Args:
            user_id: The user ID
            file_path: The file path

        Returns:
            True if successful, False otherwise
        """
        try:
            user_plots_key = self._generate_user_plots_key(user_id)
            user_plots = await self.redis_service.get_json(user_plots_key) or {}

            # Find and delete all plots for this file
            deleted_count = 0
            keys_to_remove = []

            for cache_key, plot_metadata in user_plots.items():
                if plot_metadata.get("file_path") == file_path:
                    if await self.redis_service.delete(cache_key):
                        deleted_count += 1
                    keys_to_remove.append(cache_key)

            # Remove from user plots metadata
            for key in keys_to_remove:
                del user_plots[key]

            if keys_to_remove:
                await self.redis_service.set_json(user_plots_key, user_plots)

            logger.info(
                f"Deleted {deleted_count} cached plots for user {user_id}, file {file_path}"
            )
            return True

        except Exception as e:
            logger.error(
                f"Error deleting cached plots for user {user_id}, file {file_path}: {e}"
            )
            return False

    async def cleanup_expired_plots(self) -> int:
        """
        Clean up expired plots from all users.

        Returns:
            Number of expired plots cleaned up
        """
        try:
            # Get all user plot metadata keys
            user_keys = await self.redis_service.get_keys("plot_cache:user:*:plots")

            total_cleaned = 0

            for user_key in user_keys:
                user_plots = await self.redis_service.get_json(user_key) or {}

                # Check each plot for expiration
                keys_to_remove = []
                for cache_key, plot_metadata in user_plots.items():
                    exists = await self.redis_service.exists(cache_key)
                    if not exists:
                        keys_to_remove.append(cache_key)
                        total_cleaned += 1

                # Remove expired plots from metadata
                for key in keys_to_remove:
                    del user_plots[key]

                # Update user plots metadata if any expired plots were removed
                if keys_to_remove:
                    await self.redis_service.set_json(user_key, user_plots)

            logger.info(f"Cleaned up {total_cleaned} expired cached plots")
            return total_cleaned

        except Exception as e:
            logger.error(f"Error cleaning up expired plots: {e}")
            return 0

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            # Check if Redis connection is working by trying a simple operation
            await self.redis_service.exists("health_check_test")
            return True
        except Exception as e:
            logger.error(f"PlotCacheService health check failed: {e}")
            return False

    async def close(self):
        """Close Redis connection."""
        await self.redis_service.close()
