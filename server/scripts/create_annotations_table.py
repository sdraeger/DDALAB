#!/usr/bin/env python
"""Create annotations table in the database."""

import os
import sys
from pathlib import Path

import psycopg2
from loguru import logger

# Add the parent directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Get PostgreSQL connection details from environment variables
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "ddalab")
# Default to using the current username rather than postgres
DB_USER = os.getenv("DB_USER", os.getenv("USER", "postgres"))
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# Log connection parameters
logger.info(f"Using database connection parameters:")
logger.info(f"  DB_HOST: {DB_HOST}")
logger.info(f"  DB_PORT: {DB_PORT}")
logger.info(f"  DB_NAME: {DB_NAME}")
logger.info(f"  DB_USER: {DB_USER}")

# SQL to create the annotations table
CREATE_ANNOTATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS annotations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(255) NOT NULL,
    start_time INTEGER NOT NULL, 
    end_time INTEGER,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on file_path for faster lookups
CREATE INDEX IF NOT EXISTS idx_annotations_file_path ON annotations(file_path);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id);
"""


def create_annotations_table():
    """Create the annotations table in the database."""
    logger.info(f"Connecting to PostgreSQL database {DB_NAME} on {DB_HOST}:{DB_PORT}")

    try:
        connection = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )

        cursor = connection.cursor()

        logger.info("Creating annotations table if it doesn't exist...")
        cursor.execute(CREATE_ANNOTATIONS_TABLE_SQL)

        connection.commit()
        logger.info("Annotations table created or already exists")

        # Verify the table was created
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'annotations'
            );
        """)

        table_exists = cursor.fetchone()[0]
        if table_exists:
            logger.info("Annotations table exists in the database")
        else:
            logger.error("Failed to create annotations table")

        connection.close()
        return True

    except Exception as e:
        logger.error(f"Error creating annotations table: {e}")
        return False


if __name__ == "__main__":
    success = create_annotations_table()
    if success:
        logger.info("Migration completed successfully")
        sys.exit(0)
    else:
        logger.error("Migration failed")
        sys.exit(1)
