from unittest.mock import AsyncMock, patch

import pytest
from core.services.dda_service import DDAService


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dda_service_health_check_success():
    db = AsyncMock()
    service = DDAService(db)
    with (
        patch("core.services.dda_service.Path.exists", return_value=True),
        patch("core.services.dda_service.Path.is_dir", return_value=True),
    ):
        result = await service.health_check()
        assert result is True


@pytest.mark.unit
@pytest.mark.asyncio
async def test_dda_service_health_check_failure():
    db = AsyncMock()
    service = DDAService(db)
    with patch("core.services.dda_service.Path.exists", return_value=False):
        result = await service.health_check()
        assert result is False
