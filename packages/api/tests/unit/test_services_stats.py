from unittest.mock import AsyncMock

import pytest
from core.services.stats_service import StatsService


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_service_health_check_success():
    db = AsyncMock()
    service = StatsService(db)
    service.artifact_repo = AsyncMock()
    service.artifact_repo.get_all = AsyncMock(return_value=[object()])
    result = await service.health_check()
    assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stats_service_health_check_failure():
    db = AsyncMock()
    service = StatsService(db)
    service.artifact_repo = AsyncMock()
    service.artifact_repo.get_all = AsyncMock(side_effect=Exception("fail"))
    result = await service.health_check()
    assert result is False
