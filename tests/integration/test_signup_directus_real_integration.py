"""Real integration tests for the signup page with Directus.

This test requires a running Directus instance to pass.
It uses docker-compose to start a Directus container for testing.
"""

import json
import os
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import requests

# Try to import docker, mark tests as skip if it's not available
try:
    import docker

    DOCKER_AVAILABLE = True
except ImportError:
    DOCKER_AVAILABLE = False

# Path adjustments to import from signup module
import sys

sys.path.append(str(Path(__file__).parent.parent.parent))


@pytest.fixture(scope="module")
def directus_container():
    """Start a Directus container for integration testing."""
    if not DOCKER_AVAILABLE:
        pytest.skip("Docker library not installed. Install with 'pip install docker'")

    try:
        # Check if Docker is available
        client = docker.from_env()
        client.ping()  # Will raise an exception if Docker is not running

        # Define the working directory for docker-compose
        directus_dir = Path(__file__).parent.parent.parent / "directus"

        # Start the Directus container using docker-compose
        process = subprocess.Popen(
            ["docker-compose", "up", "-d"],
            cwd=str(directus_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        process.wait(timeout=30)  # Wait for docker-compose to start

        # Wait for Directus to be ready
        directus_url = os.getenv("DIRECTUS_URL", "http://localhost:8055")
        max_retries = 30
        retries = 0

        while retries < max_retries:
            try:
                response = requests.get(f"{directus_url}/server/ping")
                if response.status_code == 200 and response.text == "pong":
                    break
            except requests.exceptions.ConnectionError:
                pass

            time.sleep(1)
            retries += 1

        if retries == max_retries:
            # Stop container and skip test if Directus doesn't start
            subprocess.Popen(
                ["docker-compose", "down", "-v"],
                cwd=str(directus_dir),
            ).wait(timeout=10)
            pytest.skip("Failed to start Directus container")

        # Set up Directus for testing
        setup_directus()

        yield

        # Tear down
        subprocess.Popen(
            ["docker-compose", "down", "-v"],
            cwd=str(directus_dir),
        ).wait(timeout=10)

    except (subprocess.SubprocessError, docker.errors.DockerException) as e:
        pytest.skip(f"Docker is not available or failed to start: {e}")


def setup_directus():
    """Run the setup_directus.py script to prepare the test environment."""
    setup_script = Path(__file__).parent.parent.parent / "signup" / "setup_directus.py"

    # Run the setup script
    process = subprocess.Popen(
        [sys.executable, str(setup_script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout, stderr = process.communicate(timeout=30)

    if process.returncode != 0:
        print(f"Directus setup failed with output: {stderr.decode()}")
        pytest.skip("Failed to set up Directus")


@pytest.fixture(scope="module")
def signup_app():
    """Start a test instance of the signup Flask app."""
    # Import the app here to ensure environment is set up
    from signup.app import app

    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False  # Disable CSRF for testing

    with app.test_client() as client:
        yield client


@pytest.mark.realintegration
@pytest.mark.skipif(not DOCKER_AVAILABLE, reason="Docker library not installed")
@pytest.mark.usefixtures("directus_container")
def test_directus_connection(signup_app):
    """Test connection to the Directus instance."""
    response = signup_app.get("/test-directus")
    assert response.status_code == 200

    response_data = json.loads(response.data)
    assert "directus_url" in response_data
    assert "connection_success" in response_data
    assert "auth_success" in response_data
    assert response_data["connection_success"] == True
    assert response_data["auth_success"] == True


@pytest.mark.realintegration
@pytest.mark.skipif(not DOCKER_AVAILABLE, reason="Docker library not installed")
@pytest.mark.usefixtures("directus_container")
def test_signup_end_to_end(signup_app):
    """Test the complete signup process with real Directus integration."""
    # Create a unique email to prevent test failures due to duplicates
    unique_email = f"test-{uuid.uuid4()}@example.com"

    # Submit a signup
    response = signup_app.post(
        "/",
        data={
            "firstName": "Integration",
            "lastName": "Test",
            "email": unique_email,
            "affiliation": "Test Laboratory",
        },
        follow_redirects=True,
    )

    # Verify successful signup
    assert response.status_code == 200
    assert b"Signup request submitted successfully!" in response.data

    # Verify the data was stored in Directus
    directus_url = os.getenv("DIRECTUS_URL", "http://localhost:8055")
    collection = os.getenv("DIRECTUS_COLLECTION", "signup_requests")

    # Get an authentication token
    auth_response = requests.post(
        f"{directus_url}/auth/login",
        json={
            "email": os.getenv("DIRECTUS_EMAIL"),
            "password": os.getenv("DIRECTUS_PASSWORD"),
        },
    )
    assert auth_response.status_code == 200
    token = auth_response.json()["data"]["access_token"]

    # Look up the newly created record
    headers = {"Authorization": f"Bearer {token}"}
    params = {"filter": {"email": {"_eq": unique_email}}}

    # Add some retries as Directus might need a moment to process the write
    max_retries = 5
    for retry in range(max_retries):
        record_response = requests.get(
            f"{directus_url}/items/{collection}",
            headers=headers,
            params={"filter": json.dumps(params["filter"])},
        )

        if record_response.status_code == 200:
            records = record_response.json()["data"]
            if len(records) == 1:
                break

        time.sleep(1)  # Wait before retrying

    assert record_response.status_code == 200
    records = record_response.json()["data"]
    assert len(records) == 1

    record = records[0]
    assert record["first_name"] == "Integration"
    assert record["last_name"] == "Test"
    assert record["email"] == unique_email
    assert record["affiliation"] == "Test Laboratory"


@pytest.mark.realintegration
@pytest.mark.skipif(not DOCKER_AVAILABLE, reason="Docker library not installed")
@pytest.mark.usefixtures("directus_container")
def test_duplicate_signup_handling(signup_app):
    """Test handling of duplicate signup requests."""
    # First, create an initial user
    unique_email = f"duplicate-{uuid.uuid4()}@example.com"

    # Submit first signup
    response1 = signup_app.post(
        "/",
        data={
            "firstName": "First",
            "lastName": "User",
            "email": unique_email,
            "affiliation": "Test Org",
        },
        follow_redirects=True,
    )

    assert response1.status_code == 200
    assert b"Signup request submitted successfully!" in response1.data

    # Submit second signup with same email but different name
    response2 = signup_app.post(
        "/",
        data={
            "firstName": "Second",
            "lastName": "User",
            "email": unique_email,
            "affiliation": "Different Org",
        },
        follow_redirects=True,
    )

    # Should show a message about duplicate
    assert response2.status_code == 200
    assert b"A request with this name or email already exists" in response2.data

    # Verify only one record exists in Directus
    directus_url = os.getenv("DIRECTUS_URL", "http://localhost:8055")
    collection = os.getenv("DIRECTUS_COLLECTION", "signup_requests")

    # Get an authentication token
    auth_response = requests.post(
        f"{directus_url}/auth/login",
        json={
            "email": os.getenv("DIRECTUS_EMAIL"),
            "password": os.getenv("DIRECTUS_PASSWORD"),
        },
    )
    token = auth_response.json()["data"]["access_token"]

    # Look up records with this email
    headers = {"Authorization": f"Bearer {token}"}
    params = {"filter": {"email": {"_eq": unique_email}}}

    record_response = requests.get(
        f"{directus_url}/items/{collection}",
        headers=headers,
        params={"filter": json.dumps(params["filter"])},
    )

    records = record_response.json()["data"]
    assert len(records) == 1  # Should only be one record

    # The record should have the original user's information
    record = records[0]
    assert record["first_name"] == "First"
    assert record["last_name"] == "User"
    assert record["affiliation"] == "Test Org"
