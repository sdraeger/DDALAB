from pathlib import Path

import bcrypt
import click
import psycopg2
from core.config import get_server_settings
from loguru import logger
from psycopg2 import Error

settings = get_server_settings()

# Directory containing .sql files
SQL_DIR = Path(__file__).parent / "sql_scripts"
DB_PARAMS = {
    "dbname": settings.db_name,
    "user": settings.db_user,
    "password": settings.db_password,
    "host": settings.db_host,
    "port": settings.db_port,
}


def connect_to_db():
    """Establish a connection to the PostgreSQL database."""
    try:
        connection = psycopg2.connect(**DB_PARAMS)
        logger.info("Successfully connected to the database")
        return connection
    except Error as e:
        logger.warning(f"Error connecting to PostgreSQL: {e}")
        return None


def execute_sql_file(connection, file_path, params=None):
    """Execute a single .sql file on the database."""
    try:
        with open(file_path, "r") as file:
            sql_content = file.read()

        if params:
            sql_content = sql_content.format(**params)

        cursor = connection.cursor()
        cursor.execute(sql_content)
        connection.commit()

        logger.info(f"Successfully executed {file_path}")
    except Error as e:
        logger.warning(f"Error executing {file_path}: {e}")
        connection.rollback()
    finally:
        cursor.close()


def apply_schema(db):
    """Apply all .sql files in the specified directory."""
    if not db:
        logger.error("Failed to connect to the database")
        return

    # Ensure the SQL directory exists
    if not SQL_DIR.exists():
        logger.error(f"Directory {SQL_DIR} not found")
        return

    execute_sql_file(db, SQL_DIR / "schema.sql")


def insert_admin_user(db, username, password, email, first_name, last_name):
    if not db:
        logger.error("Failed to connect to the database")
        return

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )

    execute_sql_file(
        db,
        SQL_DIR / "insert_admin_user.sql",
        {
            "username": username,
            "password_hash": password_hash,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
        },
    )


def check_users_exist(db):
    cur = db.cursor()

    try:
        cur.execute("SELECT COUNT(*) FROM users;")
        count = cur.fetchone()[0]
        return count > 0
    except Exception as e:
        logger.warning(f"Error checking users exist: {e}")
        db.rollback()
        return False


def check_tables_exist(db):
    cur = db.cursor()

    try:
        cur.execute("""SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'""")

        tables = cur.fetchall()
        return len(tables) > 0
    except Exception as e:
        logger.warning(f"Error checking tables exist: {e}")
        db.rollback()
        return False


@click.command()
@click.option("--username", type=str, required=True)
@click.option("--password", type=str, required=True)
@click.option("--email", type=str, required=True)
@click.option("--first_name", type=str, required=True)
@click.option("--last_name", type=str, required=True)
def main(username, password, email, first_name, last_name):
    logger.info(f"DB_PARAMS: {DB_PARAMS}")

    try:
        db = connect_to_db()

        if not check_tables_exist(db):
            logger.info("Applying schema")
            apply_schema(db)

        if not check_users_exist(db):
            logger.info("Inserting admin user")
            insert_admin_user(db, username, password, email, first_name, last_name)
    except Exception as e:
        logger.warning(f"An unexpected error occurred: {e}")
    finally:
        if db:
            db.close()
            logger.info("Database connection closed")


if __name__ == "__main__":
    main()
