"""Integration tests for the signup page and its Directus integration."""

import json
import os

# Path adjustments to import from signup module
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.append(str(Path(__file__).parent.parent.parent))


@pytest.fixture(scope="module")
def directus_mock():
    """Mock Directus API responses."""
    with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
        # Mock authentication
        auth_response = MagicMock()
        auth_response.status_code = 200
        auth_response.json.return_value = {"data": {"access_token": "mock-token"}}

        # Mock user check response
        check_response = MagicMock()
        check_response.status_code = 200
        check_response.json.return_value = {"data": []}

        # Mock creation response
        create_response = MagicMock()
        create_response.status_code = 200
        create_response.json.return_value = {"data": {"id": "mock-id"}}

        # Mock server ping response
        ping_response = MagicMock()
        ping_response.status_code = 200
        ping_response.text = "pong"

        # Configure the mocks
        def mock_post_side_effect(url, **kwargs):
            if "/auth/login" in url:
                return auth_response
            elif f"/items/{os.getenv('DIRECTUS_COLLECTION', 'signup_requests')}" in url:
                return create_response
            return MagicMock(status_code=404)

        def mock_get_side_effect(url, **kwargs):
            if "/server/ping" in url:
                return ping_response
            elif f"/items/{os.getenv('DIRECTUS_COLLECTION', 'signup_requests')}" in url:
                return check_response
            return MagicMock(status_code=404)

        mock_post.side_effect = mock_post_side_effect
        mock_get.side_effect = mock_get_side_effect

        yield (mock_post, mock_get)


@pytest.fixture(scope="module")
def signup_app():
    """Start a test instance of the signup Flask app."""
    # Set test environment variables
    os.environ["FLASK_ENV"] = "testing"
    os.environ["DIRECTUS_URL"] = "http://localhost:8055"
    os.environ["DIRECTUS_EMAIL"] = "test@example.com"
    os.environ["DIRECTUS_PASSWORD"] = "test_password"
    os.environ["DIRECTUS_COLLECTION"] = "signup_requests"
    os.environ["SECRET_KEY"] = "test-key"

    # Start the Flask app
    from signup.app import app

    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False  # Disable CSRF for testing

    with app.test_client() as client:
        yield client


@pytest.mark.integration
def test_signup_page_loads(signup_app):
    """Test that the signup page loads correctly."""
    response = signup_app.get("/")
    assert response.status_code == 200
    assert b"First Name" in response.data
    assert b"Last Name" in response.data
    assert b"Email" in response.data


@pytest.mark.integration
def test_signup_form_validation(signup_app):
    """Test form validation on the signup page."""
    # Test with missing fields
    response = signup_app.post(
        "/",
        data={
            "firstName": "Test",
            # Missing lastName
            "email": "test@example.com",
            "affiliation": "Test Org",
        },
    )
    assert response.status_code == 200
    assert b"This field is required" in response.data

    # Test with invalid email
    response = signup_app.post(
        "/",
        data={
            "firstName": "Test",
            "lastName": "User",
            "email": "invalid-email",
            "affiliation": "Test Org",
        },
    )
    assert response.status_code == 200
    assert b"Invalid email address" in response.data


@pytest.mark.integration
def test_directus_connection_check(signup_app, directus_mock):
    """Test the Directus connection check endpoint."""
    mock_post, mock_get = directus_mock

    response = signup_app.get("/test-directus")
    assert response.status_code == 200

    # Verify that authentication was attempted
    auth_call_found = False
    for call in mock_post.call_args_list:
        url = call[0][0]
        if "/auth/login" in url:
            auth_call_found = True
            break

    assert auth_call_found, "Authentication call was not made"

    # Check the response structure matches what the app actually returns
    response_data = json.loads(response.data)
    assert "directus_url" in response_data
    assert "connection_success" in response_data
    assert "auth_success" in response_data
    assert response_data["connection_success"]
    assert response_data["auth_success"]


@pytest.mark.integration
def test_successful_signup(signup_app, directus_mock):
    """Test a successful signup that creates a Directus record."""
    mock_post, mock_get = directus_mock

    # Submit a valid signup
    response = signup_app.post(
        "/",
        data={
            "firstName": "Test",
            "lastName": "User",
            "email": "test@example.com",
            "affiliation": "Test Organization",
        },
        follow_redirects=True,
    )

    # Check response
    assert response.status_code == 200
    # Instead of looking for "Thank you", check for the success flash message banner
    assert b"Signup request submitted successfully!" in response.data

    # Verify Directus API calls
    create_call_found = False
    for call in mock_post.call_args_list:
        url, kwargs = call[0][0], call[1]
        if f"/items/{os.getenv('DIRECTUS_COLLECTION', 'signup_requests')}" in url:
            create_call_found = True
            # Verify request data
            data = kwargs.get("json", {})
            assert data.get("first_name") == "Test"
            assert data.get("last_name") == "User"
            assert data.get("email") == "test@example.com"
            assert data.get("affiliation") == "Test Organization"

    assert create_call_found, "No Directus create call was made"


@pytest.mark.integration
def test_duplicate_signup(signup_app):
    """Test handling of duplicate signup requests."""
    # Use a fresh set of mocks for this test to avoid interference from previous tests
    with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
        # Set up auth response
        auth_response = MagicMock()
        auth_response.status_code = 200
        auth_response.json.return_value = {"data": {"access_token": "mock-token"}}

        # Mock server ping response
        ping_response = MagicMock()
        ping_response.status_code = 200
        ping_response.text = "pong"

        # Configure the mock to return an existing user
        check_response = MagicMock()
        check_response.status_code = 200
        check_response.json.return_value = {
            "data": [
                {
                    "id": "existing-id",
                    "email": "test@example.com",
                    "first_name": "Test",
                    "last_name": "User",
                }
            ]
        }

        # Set up the post mock
        def mock_post_side_effect(url, **kwargs):
            if "/auth/login" in url:
                return auth_response
            # Don't handle the create endpoint - we don't expect it to be called
            return MagicMock(status_code=404)

        # Set up the get mock
        def mock_get_side_effect(url, **kwargs):
            if "/server/ping" in url:
                return ping_response
            # Always return the check_response for any items request
            elif f"/items/{os.getenv('DIRECTUS_COLLECTION', 'signup_requests')}" in url:
                # Check if this is a request with the appropriate filter parameters
                if "params" in kwargs and "filter" in kwargs["params"]:
                    filter_data = json.loads(kwargs["params"]["filter"])
                    # If this is checking for our test email, return existing data
                    if "_or" in filter_data and any(
                        "email" in condition for condition in filter_data["_or"]
                    ):
                        return check_response
                return check_response
            return MagicMock(status_code=404)

        mock_post.side_effect = mock_post_side_effect
        mock_get.side_effect = mock_get_side_effect

        # Submit a signup with existing email
        response = signup_app.post(
            "/",
            data={
                "firstName": "Test",
                "lastName": "User",
                "email": "test@example.com",
                "affiliation": "Test Organization",
            },
            follow_redirects=True,
        )

        # Should display error message about duplicate
        assert response.status_code == 200
        assert b"A request with this name or email already exists" in response.data

        # Verify create API wasn't called for duplicate
        create_call_count = 0
        for call in mock_post.call_args_list:
            url = call[0][0]
            if f"/items/{os.getenv('DIRECTUS_COLLECTION', 'signup_requests')}" in url:
                create_call_count += 1

        # The create API should not be called for duplicates
        assert create_call_count == 0, "Create API was called for duplicate user"
