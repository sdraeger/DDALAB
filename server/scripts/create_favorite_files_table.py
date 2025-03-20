"""Create favorite_files table in the database."""

import os
import sys

import psycopg2
from dotenv import load_dotenv
from loguru import logger

# Load environment variables from .env file
load_dotenv()

# Add parent directory to path for imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Get PostgreSQL connection details from environment variables
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "ddalab")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "123456")

logger.info("Starting favorite_files table creation script")


def check_table_exists(cursor, table_name):
    """Check if a table exists in the database."""
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = %s
        );
        """,
        (table_name,),
    )
    return cursor.fetchone()[0]


def create_favorite_files_table():
    """Create the favorite_files table in the database."""
    logger.info(f"Connecting to PostgreSQL database {DB_NAME} on {DB_HOST}:{DB_PORT}")

    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )
        conn.autocommit = True
        cursor = conn.cursor()

        # Check if the table already exists
        if check_table_exists(cursor, "favorite_files"):
            logger.info("Favorite files table already exists in the database")
            return

        # Create the table
        logger.info("Creating favorite_files table...")
        cursor.execute(
            """
            CREATE TABLE favorite_files (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                file_path TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, file_path)
            );
            """
        )

        # Create an index on file_path for faster lookups
        cursor.execute(
            """
            CREATE INDEX favorite_files_file_path_idx ON favorite_files (file_path);
            """
        )

        logger.info("Favorite files table created successfully")

    except Exception as e:
        logger.error(f"Error creating favorite_files table: {e}")
        return False
    finally:
        if "conn" in locals():
            conn.close()

    return True


if __name__ == "__main__":
    create_favorite_files_table()
