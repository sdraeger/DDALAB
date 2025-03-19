#!/usr/bin/env python3
"""
Test script for user synchronization between SQLite and Directus.
"""

import json
import logging
import os
import sys

import requests

# Add the parent directory to the path so we can import server modules
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from server.core.auth import create_user, get_password_hash
from server.core.database import User, get_db
from server.core.directus_sync import (
    get_directus_token,
    get_directus_users,
    sync_users_to_directus,
)

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("test_sync")


def create_test_user(db):
    """Create a test user in the SQLite database."""
    test_username = f"test_user_{os.urandom(4).hex()}"

    # Check if user already exists
    existing_user = db.query(User).filter(User.username == test_username).first()
    if existing_user:
        logger.info(f"Test user {test_username} already exists")
        return existing_user

    # Create new test user
    logger.info(f"Creating test user {test_username}")
    user = User(
        username=test_username,
        password_hash=get_password_hash("password123"),
        is_active=True,
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def check_user_in_directus(username):
    """Check if the user exists in Directus."""
    token = get_directus_token()
    if not token:
        logger.error("Failed to authenticate with Directus")
        return False

    directus_users = get_directus_users(token)
    for user in directus_users:
        if user["username"] == username:
            logger.info(f"User {username} found in Directus")
            return True

    logger.info(f"User {username} NOT found in Directus")
    return False


def main():
    """Main test function."""
    logger.info("Starting synchronization test")

    # Get database session
    db_generator = get_db()
    db = next(db_generator)

    try:
        # Create a test user
        test_user = create_test_user(db)
        logger.info(f"Created test user: {test_user.username}")

        # Check if user exists in Directus before sync
        exists_before = check_user_in_directus(test_user.username)

        # Run synchronization
        logger.info("Running user synchronization")
        result = sync_users_to_directus(db)

        if not result:
            logger.error("Synchronization failed")
            return 1

        # Check if user exists in Directus after sync
        exists_after = check_user_in_directus(test_user.username)

        if not exists_before and exists_after:
            logger.info("Test PASSED: User was successfully synchronized to Directus")
            return 0
        elif exists_before and exists_after:
            logger.info("Test PASSED: User already existed in Directus")
            return 0
        else:
            logger.error("Test FAILED: User was not synchronized to Directus")
            return 1

    finally:
        # Close database session
        db_generator.close()


if __name__ == "__main__":
    sys.exit(main())
