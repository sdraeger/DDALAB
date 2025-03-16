"""Unit tests for error handler."""

from unittest.mock import MagicMock, patch

import pytest

from ddalab.core.error_handler import handle_errors, log_error, show_error_dialog
from ddalab.core.exceptions import (
    DDALabException,
    FileOperationError,
    NetworkError,
    ValidationError,
)


@pytest.fixture
def mock_logger():
    """Mock logger for testing."""
    with patch("ddalab.core.error_handler.logger") as mock:
        yield mock


def test_handle_errors_decorator():
    """Test handle_errors decorator."""

    # Create a function that raises an exception
    @handle_errors(error_type=NetworkError, show_dialog=False)
    def failing_function():
        raise Exception("Test error")
        return True

    # Function should return None instead of raising
    assert failing_function() is None


def test_handle_errors_with_default_value():
    """Test handle_errors with default value."""

    # Create a function that raises an exception
    @handle_errors(error_type=NetworkError, show_dialog=False, default_value=False)
    def failing_function():
        raise Exception("Test error")
        return True

    # Function should return default value instead of raising
    assert failing_function() is False


@patch("ddalab.core.error_handler.QMessageBox")
def test_show_error_dialog(mock_qmessagebox):
    """Test show_error_dialog function."""
    mock_box = MagicMock()
    mock_qmessagebox.return_value = mock_box

    show_error_dialog("Test error", "Test Title")

    # Check that QMessageBox was configured correctly
    mock_box.setWindowTitle.assert_called_once_with("Test Title")
    mock_box.setText.assert_called_once_with("Test error")
    mock_box.exec.assert_called_once()


def test_log_error(mock_logger):
    """Test log_error function."""
    error = Exception("Test error")
    log_error(error, "Test context")

    # Check that error was logged
    mock_logger.error.assert_called_once()
