from unittest.mock import MagicMock, patch

import pytest
from core.files import validate_file_path
from fastapi import HTTPException


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_file_path_success():
    with patch(
        "core.files.is_path_allowed", return_value=MagicMock(exists=lambda: True)
    ):
        result = await validate_file_path("/some/path")
        assert result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_validate_file_path_not_found():
    with patch(
        "core.files.is_path_allowed", return_value=MagicMock(exists=lambda: False)
    ):
        with pytest.raises(HTTPException):
            await validate_file_path("/some/path")
