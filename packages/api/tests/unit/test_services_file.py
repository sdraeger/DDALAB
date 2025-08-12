from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from core.services.file_service import FileService


@pytest.mark.unit
@pytest.mark.asyncio
async def test_file_service_list_directory_success():
    db = AsyncMock()
    service = FileService(db)
    mock_path = MagicMock()
    mock_path.is_dir.return_value = True
    mock_path.iterdir.return_value = []
    with patch("core.services.file_service.is_path_allowed", return_value=mock_path):
        try:
            await service.list_directory("")
        except Exception:
            pytest.fail(
                "list_directory should not raise an exception when path is allowed"
            )
