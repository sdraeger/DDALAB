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
        connection.autocommit = False  # Ensure explicit transaction control
        logger.info("Successfully connected to the database")
        return connection
    except Error as e:
        logger.error(f"Error connecting to PostgreSQL: {e}")
        return None


def execute_sql_file(connection, file_path, params=None):
    """Execute a single .sql file on the database."""
    cursor = None
    try:
        with open(file_path, "r") as file:
            sql_content = file.read()

        if params:
            sql_content = sql_content.format(**params)

        cursor = connection.cursor()
        cursor.execute(sql_content)
        connection.commit()

        logger.info(f"Successfully executed {file_path}")
        return True
    except Error as e:
        logger.error(f"Error executing {file_path}: {e}")
        connection.rollback()
        return False
    finally:
        if cursor:
            cursor.close()


def apply_schema(db, owner):
    """Apply all .sql files in the specified directory with the specified owner."""
    if not db:
        logger.error("Failed to connect to the database")
        return False

    # Ensure the SQL directory exists
    if not SQL_DIR.exists():
        logger.error(f"Directory {SQL_DIR} not found")
        return False

    success = execute_sql_file(db, SQL_DIR / "schema.sql", {"owner": owner})
    if not success:
        logger.error("Failed to apply schema")
        return False
    db.commit()  # Ensure schema changes are committed
    return True


def insert_admin_user(db, username, password, email, first_name, last_name):
    if not db:
        logger.error("Failed to connect to the database")
        return False

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode(
        "utf-8"
    )

    success = execute_sql_file(
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
    if not success:
        logger.error("Failed to insert admin user")
        return False
    db.commit()  # Ensure admin user insertion is committed
    return True


def check_users_exist(db):
    if not db:
        logger.error("Failed to connect to the database")
        return False

    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM public.users;")
        count = cursor.fetchone()[0]
        return count > 0
    except Error as e:
        logger.warning(f"Error checking users exist: {e}")
        db.rollback()
        return False
    finally:
        if cursor:
            cursor.close()


def check_tables_exist(db):
    if not db:
        logger.error("Failed to connect to the database")
        return False

    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute(
            """SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public'"""
        )
        tables = cursor.fetchall()
        return len(tables) > 0
    except Error as e:
        logger.warning(f"Error checking tables exist: {e}")
        db.rollback()
        return False
    finally:
        if cursor:
            cursor.close()


@click.command()
@click.option("--username", type=str, required=True)
@click.option("--password", type=str, required=True)
@click.option("--email", type=str, required=True)
@click.option("--first_name", type=str, required=True)
@click.option("--last_name", type=str, required=True)
def main(username, password, email, first_name, last_name):
    logger.info(f"DB_PARAMS: {DB_PARAMS}")

    db = None
    try:
        db = connect_to_db()
        if not db:
            return

        tables_exist = check_tables_exist(db)
        logger.info(f"Tables exist: {tables_exist}")
        if not tables_exist:
            logger.info("Applying schema")
            if not apply_schema(db, username):
                return

        users_exist = check_users_exist(db)
        logger.info(f"Users exist: {users_exist}")
        if not users_exist:
            logger.info("Inserting admin user")
            if not insert_admin_user(db, username, password, email, first_name, last_name):
                return
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
    finally:
        if db:
            db.close()
            logger.info("Database connection closed")


if __name__ == "__main__":
    main()
