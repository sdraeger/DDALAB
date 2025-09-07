"""Health check endpoints for monitoring."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from core.dependencies import get_db
from core.services import MinioService
from core.environment import get_config_service
import redis.asyncio as redis
from datetime import datetime
from loguru import logger

router = APIRouter()


@router.get("")
async def health():
    """Basic health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "ddalab-api"
    }


@router.get("/detailed")
async def detailed_health_check(db: AsyncSession = Depends(get_db)):
    """Detailed health check with dependency status."""
    health_status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "ddalab-api",
        "checks": {}
    }
    
    # Check database
    try:
        result = await db.execute(text("SELECT 1"))
        await db.commit()
        health_status["checks"]["database"] = {
            "status": "healthy",
            "message": "Database connection successful"
        }
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        health_status["checks"]["database"] = {
            "status": "unhealthy",
            "message": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check Redis
    try:
        cache_settings = get_config_service().get_cache_settings()
        redis_client = await redis.from_url(
            f"redis://{cache_settings.redis_host}:{cache_settings.redis_port}",
            decode_responses=True
        )
        await redis_client.ping()
        await redis_client.close()
        health_status["checks"]["redis"] = {
            "status": "healthy",
            "message": "Redis connection successful"
        }
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        health_status["checks"]["redis"] = {
            "status": "unhealthy",
            "message": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check MinIO
    try:
        storage_settings = get_config_service().get_storage_settings()
        minio_service = MinioService(
            endpoint=storage_settings.minio_host,
            access_key=storage_settings.minio_access_key,
            secret_key=storage_settings.minio_secret_key,
            bucket_name=storage_settings.minio_bucket_name
        )
        # Simple check - list buckets
        buckets = minio_service.client.list_buckets()
        health_status["checks"]["minio"] = {
            "status": "healthy",
            "message": f"MinIO connection successful, {len(buckets)} buckets found"
        }
    except Exception as e:
        logger.error(f"MinIO health check failed: {e}")
        health_status["checks"]["minio"] = {
            "status": "unhealthy",
            "message": str(e)
        }
        health_status["status"] = "degraded"
    
    # Check DDA binary
    try:
        dda_settings = get_config_service().get_dda_settings()
        import os
        if os.path.exists(dda_settings.dda_binary_path):
            health_status["checks"]["dda_binary"] = {
                "status": "healthy",
                "message": f"DDA binary found at {dda_settings.dda_binary_path}"
            }
        else:
            health_status["checks"]["dda_binary"] = {
                "status": "unhealthy",
                "message": f"DDA binary not found at {dda_settings.dda_binary_path}"
            }
            health_status["status"] = "degraded"
    except Exception as e:
        logger.error(f"DDA binary check failed: {e}")
        health_status["checks"]["dda_binary"] = {
            "status": "unhealthy",
            "message": str(e)
        }
        health_status["status"] = "degraded"
    
    # Set appropriate HTTP status code
    if health_status["status"] == "unhealthy":
        raise HTTPException(status_code=503, detail=health_status)
    
    return health_status


@router.get("/ready")
async def readiness_check(db: AsyncSession = Depends(get_db)):
    """Kubernetes-style readiness probe."""
    try:
        # Quick database check
        await db.execute(text("SELECT 1"))
        await db.commit()
        return {"ready": True}
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        raise HTTPException(status_code=503, detail={"ready": False, "error": str(e)})


@router.get("/live")
async def liveness_check():
    """Kubernetes-style liveness probe."""
    return {"alive": True}
