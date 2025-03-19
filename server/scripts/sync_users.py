#!/usr/bin/env python3
"""
Script to synchronize users between PostgreSQL and Directus.
This can be run manually or scheduled with cron.
"""

import logging
import os
import sys
import traceback

import psycopg2
from psycopg2.extras import DictCursor

# Add the parent directory to the path so we can import server modules
sys.path.append(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from dotenv import load_dotenv

from server.core.directus_sync import sync_users_to_directus

# Setup logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("sync_users")

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

# PostgreSQL connection details
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "ddalab")
DB_USER = os.getenv("DB_USER", "simon")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")


def get_postgres_connection():
    """Get a connection to the PostgreSQL database"""
    logger.info(f"Connecting to PostgreSQL database: {DB_NAME} on {DB_HOST}")

    try:
        connection = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )
        return connection
    except Exception as e:
        logger.error(f"Failed to connect to PostgreSQL: {e}")
        return None


class PostgresUserAdapter:
    """Adapter class to provide a compatible interface with the sync function"""

    def __init__(self, connection):
        self.connection = connection
        self.cursor = connection.cursor(cursor_factory=DictCursor)

    def query(self, model_class):
        """Mimic the SQLAlchemy query method but use PostgreSQL"""
        return PostgresQueryAdapter(self.cursor, model_class)


class PostgresQueryAdapter:
    """Adapter for query operations"""

    def __init__(self, cursor, model_class):
        self.cursor = cursor
        self.model_name = model_class.__name__

    def all(self):
        """Get all users from PostgreSQL"""
        try:
            # Use correct field names from the database
            self.cursor.execute(
                """
                SELECT 
                    id, 
                    username, 
                    password_hash, 
                    is_active, 
                    is_admin 
                FROM users
                """
            )
            rows = self.cursor.fetchall()
            return [PostgresUserModel(**dict(row)) for row in rows]
        except Exception as e:
            logger.error(f"Error fetching users from PostgreSQL: {e}")
            # Print more details about the error
            import traceback

            logger.error(traceback.format_exc())
            return []


class PostgresUserModel:
    """Model class to represent a user from PostgreSQL"""

    def __init__(self, id, username, password_hash, is_active=True, is_admin=False):
        self.id = id
        self.username = username
        # Map password_hash to hashed_password for compatibility with directus_sync.py
        self.password_hash = password_hash
        self.hashed_password = password_hash  # For compatibility with some functions
        self.is_active = is_active
        self.is_admin = is_admin
        self.is_superuser = is_admin  # For compatibility with directus_sync.py that might check is_superuser


# Mock User class to maintain compatibility with sync_users_to_directus
class User:
    """User model class for compatibility"""

    pass


def main():
    """Main function to run the synchronization"""
    logger.info("Starting user synchronization with PostgreSQL")

    # Get a PostgreSQL connection
    connection = get_postgres_connection()
    if not connection:
        logger.error("Failed to connect to PostgreSQL database. Exiting.")
        return 1

    try:
        # Check if the users table exists and has the expected structure
        cursor = connection.cursor()
        try:
            cursor.execute("SELECT COUNT(*) FROM users")
            count = cursor.fetchone()[0]
            logger.info(f"Found {count} users in the PostgreSQL database")

            # Get table structure
            cursor.execute("""
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'users' 
                ORDER BY ordinal_position
            """)
            columns = cursor.fetchall()
            logger.info(f"Table structure for 'users': {columns}")
        except Exception as e:
            logger.error(f"Error checking database structure: {e}")
            logger.error(traceback.format_exc())

        # Create a DB adapter that mimics the SQLAlchemy session
        db = PostgresUserAdapter(connection)

        # Run the synchronization
        success = sync_users_to_directus(db, User)

        if success:
            logger.info("User synchronization completed successfully")
            return 0
        else:
            logger.error("User synchronization failed")
            return 1
    finally:
        # Close the database connection
        connection.close()
        logger.info("PostgreSQL connection closed")


if __name__ == "__main__":
    sys.exit(main())
