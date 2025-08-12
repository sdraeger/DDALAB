from unittest.mock import patch

import pytest
from core.dda.binary_validation import validate_dda_binary


class DummySettings:
    dda_binary_path = "/fake/path/to/dda"


@pytest.mark.unit
def test_validate_dda_binary_success():
    with (
        patch("core.dda.binary_validation.Path.exists", return_value=True),
        patch("core.dda.binary_validation.os.access", return_value=True),
        patch("core.dda.binary_validation.dda_py.init", return_value=None),
    ):
        valid, error = validate_dda_binary(DummySettings())
        assert valid is True
        assert error is None


@pytest.mark.unit
def test_validate_dda_binary_not_found():
    with patch("core.dda.binary_validation.Path.exists", return_value=False):
        valid, error = validate_dda_binary(DummySettings())
        assert valid is False
        assert "not found" in error
