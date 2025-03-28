#!/usr/bin/env python3
"""
Script to verify environment settings and connections.
Run this before using sync_users.py to ensure connections work.
"""

import logging
import os
import sys

import psycopg2
import requests
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("verify_env")

# Add the parent directory to the path
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

# Load environment variables from multiple possible locations
script_dir = os.path.dirname(os.path.abspath(__file__))
server_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
project_root = os.path.dirname(server_dir)

# Try to load from both places
env_files = [
    os.path.join(project_root, ".env"),
    os.path.join(server_dir, ".env"),
    os.path.join(script_dir, ".env"),
]

for env_file in env_files:
    if os.path.exists(env_file):
        logger.info(f"Loading environment variables from {env_file}")
        load_dotenv(env_file)


def check_postgres_connection():
    """Check PostgreSQL connection"""
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "5432")
    DB_NAME = os.getenv("DB_NAME", "ddalab")
    DB_USER = os.getenv("DB_USER", "")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")

    logger.info(f"Checking PostgreSQL connection to {DB_NAME} on {DB_HOST}:{DB_PORT}")

    if not DB_USER:
        logger.error("DB_USER environment variable is not set")
        return False

    try:
        connection = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )

        cursor = connection.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()
        logger.info(f"Successfully connected to PostgreSQL: {version[0]}")

        # Check if users table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        """)
        table_exists = cursor.fetchone()[0]

        if table_exists:
            logger.info("Users table exists in database")
            cursor.execute("SELECT COUNT(*) FROM users")
            count = cursor.fetchone()[0]
            logger.info(f"Found {count} users in the database")
        else:
            logger.error("Users table does not exist in database")

        connection.close()
        return True
    except Exception as e:
        logger.error(f"PostgreSQL connection failed: {e}")
        return False


def check_directus_connection():
    """Check Directus connection"""
    DIRECTUS_URL = os.getenv("DIRECTUS_URL", "http://localhost:8055")
    DIRECTUS_EMAIL = os.getenv("DIRECTUS_EMAIL", "")
    DIRECTUS_PASSWORD = os.getenv("DIRECTUS_PASSWORD", "")

    logger.info(f"Checking Directus connection to {DIRECTUS_URL}")

    if not DIRECTUS_EMAIL or not DIRECTUS_PASSWORD:
        logger.error(
            "DIRECTUS_EMAIL or DIRECTUS_PASSWORD environment variables are not set"
        )
        return False

    try:
        # Check if Directus is running
        response = requests.get(f"{DIRECTUS_URL}/server/info")
        if response.status_code == 200:
            logger.info(f"Directus is running: {response.json()}")
        else:
            logger.error(
                f"Directus server info returned status code: {response.status_code}"
            )
            return False

        # Try to authenticate
        auth_response = requests.post(
            f"{DIRECTUS_URL}/auth/login",
            json={"email": DIRECTUS_EMAIL, "password": DIRECTUS_PASSWORD},
        )

        if auth_response.status_code == 200:
            token = auth_response.json()["data"]["access_token"]
            logger.info("Successfully authenticated with Directus")

            # Check if users collection exists
            USER_COLLECTION = os.getenv("USER_COLLECTION", "users")
            headers = {"Authorization": f"Bearer {token}"}
            collection_response = requests.get(
                f"{DIRECTUS_URL}/collections/{USER_COLLECTION}", headers=headers
            )

            if collection_response.status_code == 200:
                logger.info(f"Collection '{USER_COLLECTION}' exists in Directus")
            else:
                logger.warning(
                    f"Collection '{USER_COLLECTION}' does not exist in Directus (will be created during sync)"
                )

            return True
        else:
            logger.error(
                f"Directus authentication failed: {auth_response.status_code} {auth_response.text}"
            )
            return False

    except Exception as e:
        logger.error(f"Directus connection failed: {e}")
        return False


def main():
    """Main function to verify environment"""
    success = True

    # Check PostgreSQL connection
    if not check_postgres_connection():
        success = False

    # Check Directus connection
    if not check_directus_connection():
        success = False

    if success:
        logger.info("All environment checks passed! You can now run sync_users.py")
        return 0
    else:
        logger.error(
            "Environment verification failed. Please fix the issues before running sync_users.py"
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
