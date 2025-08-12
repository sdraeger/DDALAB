"""Redis service for caching operations."""

import json
import pickle
from typing import Any, Dict, List, Optional

import aioredis
from loguru import logger

from ..environment import get_config_service
from ..service_registry import register_service


@register_service
class RedisService:
    """Service for Redis operations."""

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        db: Optional[int] = None,
        password: Optional[str] = None,
        use_ssl: Optional[bool] = None,
    ):
        cache_settings = get_config_service().get_cache_settings()
        self._host = host if host is not None else cache_settings.redis_host
        self._port = port if port is not None else cache_settings.redis_port
        self._db = db if db is not None else cache_settings.redis_db
        self._password = (
            password if password is not None else cache_settings.redis_password
        )
        self._use_ssl = use_ssl if use_ssl is not None else cache_settings.redis_use_ssl
        self._redis: Optional[aioredis.Redis] = None

    @classmethod
    def from_db(cls, db=None) -> "RedisService":
        """Create a service instance for dependency injection."""
        return cls()

    async def get_redis(self) -> aioredis.Redis:
        """Get Redis connection."""
        if self._redis is None:
            # Build connection URL with SSL if needed
            if self._use_ssl:
                url = f"rediss://{self._host}:{self._port}"
            else:
                url = f"redis://{self._host}:{self._port}"

            # Build connection parameters
            connection_params = {
                "db": self._db,
                "decode_responses": False,  # Keep as bytes for pickle compatibility
                "encoding": "utf-8",
            }

            # Add password if provided
            if self._password:
                connection_params["password"] = self._password

            self._redis = aioredis.from_url(url, **connection_params)
        return self._redis

    async def close(self):
        """Close Redis connection."""
        if self._redis:
            await self._redis.close()
            self._redis = None

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set a key-value pair in Redis."""
        try:
            logger.debug(
                f"[RedisService] Setting key: {key}, ttl: {ttl}, value_size: {len(str(value)) if value else 0}"
            )
            redis = await self.get_redis()
            # Serialize value using pickle for complex objects
            serialized_value = pickle.dumps(value)
            logger.debug(
                f"[RedisService] Serialized value size: {len(serialized_value)} bytes"
            )

            if ttl:
                result = await redis.setex(key, ttl, serialized_value)
                logger.info(
                    f"[RedisService] Set key with TTL: {key} (TTL: {ttl}s) - Result: {result}"
                )
            else:
                result = await redis.set(key, serialized_value)
                logger.info(
                    f"[RedisService] Set key without TTL: {key} - Result: {result}"
                )

            return result
        except Exception as e:
            logger.error(f"[RedisService] Error setting Redis key {key}: {e}")
            return False

    async def get(self, key: str) -> Optional[Any]:
        """Get a value from Redis."""
        try:
            logger.debug(f"[RedisService] Getting key: {key}")
            redis = await self.get_redis()
            value = await redis.get(key)
            if value is None:
                logger.debug(f"[RedisService] Key not found: {key}")
                return None

            # Deserialize value using pickle
            deserialized_value = pickle.loads(value)
            logger.info(
                f"[RedisService] Retrieved key: {key}, value_size: {len(str(deserialized_value)) if deserialized_value else 0}"
            )
            return deserialized_value
        except Exception as e:
            logger.error(f"[RedisService] Error getting Redis key {key}: {e}")
            return None

    async def delete(self, key: str) -> bool:
        """Delete a key from Redis."""
        try:
            logger.debug(f"[RedisService] Deleting key: {key}")
            redis = await self.get_redis()
            result = await redis.delete(key)
            success = result > 0
            logger.info(f"[RedisService] Delete key: {key} - Result: {success}")
            return success
        except Exception as e:
            logger.error(f"[RedisService] Error deleting Redis key {key}: {e}")
            return False

    async def exists(self, key: str) -> bool:
        """Check if a key exists in Redis."""
        try:
            logger.debug(f"[RedisService] Checking existence of key: {key}")
            redis = await self.get_redis()
            result = await redis.exists(key)
            exists = result > 0
            logger.debug(f"[RedisService] Key exists check: {key} - Result: {exists}")
            return exists
        except Exception as e:
            logger.error(f"[RedisService] Error checking Redis key {key}: {e}")
            return False

    async def set_json(
        self, key: str, value: Dict[str, Any], ttl: Optional[int] = None
    ) -> bool:
        """Set a JSON value in Redis."""
        try:
            redis = await self.get_redis()
            json_value = json.dumps(value)
            if ttl:
                return await redis.setex(key, ttl, json_value)
            else:
                return await redis.set(key, json_value)
        except Exception as e:
            logger.error(f"Error setting JSON Redis key {key}: {e}")
            return False

    async def get_json(self, key: str) -> Optional[Dict[str, Any]]:
        """Get a JSON value from Redis."""
        try:
            redis = await self.get_redis()
            value = await redis.get(key)
            if value is None:
                return None
            return json.loads(value.decode("utf-8"))
        except Exception as e:
            logger.error(f"Error getting JSON Redis key {key}: {e}")
            return None

    async def get_keys(self, pattern: str) -> List[str]:
        """Get keys matching a pattern."""
        try:
            redis = await self.get_redis()
            keys = await redis.keys(pattern)
            return [key.decode("utf-8") for key in keys]
        except Exception as e:
            logger.error(f"Error getting Redis keys with pattern {pattern}: {e}")
            return []

    async def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching a pattern."""
        try:
            redis = await self.get_redis()
            keys = await redis.keys(pattern)
            if keys:
                result = await redis.delete(*keys)
                return result
            return 0
        except Exception as e:
            logger.error(f"Error deleting Redis keys with pattern {pattern}: {e}")
            return 0

    async def expire(self, key: str, ttl: int) -> bool:
        """Set expiration time for a key."""
        try:
            redis = await self.get_redis()
            return await redis.expire(key, ttl)
        except Exception as e:
            logger.error(f"Error setting expiration for Redis key {key}: {e}")
            return False

    async def ttl(self, key: str) -> int:
        """Get time to live for a key."""
        try:
            redis = await self.get_redis()
            return await redis.ttl(key)
        except Exception as e:
            logger.error(f"Error getting TTL for Redis key {key}: {e}")
            return -1
