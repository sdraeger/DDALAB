"""Dashboard routes."""

from datetime import datetime, timedelta, timezone
from typing import List

from core.auth import get_current_user
from core.database import get_db
from core.dependencies import get_service
from core.models import User
from core.services import ArtifactService, StatsService, UserService
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from schemas.auth.auth import UserResponse
from schemas.dashboard import StatsResponse
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(tags=["dashboard"])


@router.get("/stats", response_model=StatsResponse)
async def get_dashboard_stats(
    _: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
    user_service: UserService = Depends(get_service(UserService)),
    stats_service: StatsService = Depends(get_service(StatsService)),
) -> StatsResponse:
    """Get dashboard statistics."""
    try:
        # Get all artifacts count
        artifacts = await artifact_service.get_all_artifacts()
        total_artifacts = len(artifacts)

        # For analyses count, use the same as artifacts since each artifact represents an analysis
        total_analyses = total_artifacts

        # Get all users and count active ones (logged in within last 30 minutes)
        all_users = await user_service.get_all()

        # Calculate active users based on recent login activity
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        active_threshold = now - timedelta(minutes=30)  # 30 minutes threshold

        active_users = list(
            filter(
                lambda x: x.last_login and x.last_login > active_threshold, all_users
            )
        )
        logger.debug(f"Active users: {list(map(lambda x: x.username, active_users))}")

        logger.info(
            f"Active users count: {len(active_users)} out of {len(all_users)} total users"
        )

        # Determine system health based on service health checks
        system_health = "excellent"
        try:
            artifact_health = await artifact_service.health_check()
            user_health = await user_service.health_check()
            stats_health = await stats_service.health_check()

            health_checks = [artifact_health, user_health, stats_health]
            healthy_services = sum(health_checks)

            if healthy_services == len(health_checks):
                system_health = "excellent"
            elif healthy_services >= len(health_checks) * 0.75:
                system_health = "good"
            elif healthy_services >= len(health_checks) * 0.5:
                system_health = "fair"
            else:
                system_health = "poor"

        except Exception as e:
            logger.warning(f"Health check failed: {e}")
            system_health = "fair"

        n_active_users = len(active_users)

        return StatsResponse(
            totalArtifacts=total_artifacts,
            totalAnalyses=total_analyses,
            activeUsers=n_active_users,
            systemHealth=system_health,
        )

    except Exception as e:
        logger.error(f"Failed to get dashboard stats: {e}")
        raise HTTPException(
            status_code=500, detail="Failed to get dashboard statistics"
        )


@router.get("/users", response_model=List[UserResponse])
async def get_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[User]:
    """Get all users."""
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        service = UserService()
        users = await service.get_all()
        return users
    except Exception as e:
        logger.error(f"Failed to get users: {e}")
        raise HTTPException(status_code=500, detail="Failed to get users")
