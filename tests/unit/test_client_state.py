"""Unit tests for client state management."""

from unittest.mock import MagicMock, patch

import pytest

from ddalab.core.state import AppState, StateEvent, StateManager


@pytest.fixture
def app_state():
    """Create an app state for testing."""
    return AppState()


@pytest.fixture
def state_manager():
    """Create a state manager for testing."""
    return StateManager()


def test_app_state_initialization(app_state):
    """Test app state initialization."""
    assert app_state.selected_file is None
    assert app_state.is_processing is False
    assert app_state.error_message is None


def test_app_state_update():
    """Test updating app state."""
    state = AppState()

    # Update selected file - using update method instead of direct assignment
    updated_state = state.update(selected_file="test_file.txt")
    assert updated_state.selected_file == "test_file.txt"
    assert state.selected_file is None  # Original state is unchanged

    # Update processing status
    updated_state = updated_state.update(is_processing=True)
    assert updated_state.is_processing is True

    # Update error message
    updated_state = updated_state.update(error_message="Test error")
    assert updated_state.error_message == "Test error"


def test_state_manager_update(state_manager):
    """Test that state manager updates state correctly."""
    # Initial state
    assert state_manager.state.selected_file is None

    # Update state through manager
    state_manager.update(selected_file="test_file.txt")
    assert state_manager.state.selected_file == "test_file.txt"

    state_manager.update(is_processing=True)
    assert state_manager.state.is_processing is True


@patch("ddalab.core.state.StateManager._notify")
def test_state_change_notifications(mock_notify, state_manager):
    """Test that state changes trigger appropriate notifications."""
    # Update file selection
    state_manager.update(selected_file="test_file.txt")
    mock_notify.assert_called_with(StateEvent.FILE_SELECTED)

    # Update processing status
    mock_notify.reset_mock()
    state_manager.update(is_processing=True)
    mock_notify.assert_called_with(StateEvent.PROCESSING_STARTED)

    # Update error message
    mock_notify.reset_mock()
    state_manager.update(error_message="Test error")
    mock_notify.assert_called_with(StateEvent.ERROR_OCCURRED)
