from pathlib import Path

import bcrypt
import click
import psycopg2
from loguru import logger
from psycopg2 import Error
from sql_scripts.table_config import (
    TABLE_FILE_MAP,
    get_execution_order_for_tables,
)

# Directory containing .sql files
SQL_DIR = Path(__file__).parent / "sql_scripts"


def connect_to_db(dbname, user, password, host, port):
    """Establish a connection to the PostgreSQL database."""
    try:
        connection = psycopg2.connect(
            dbname=dbname, user=user, password=password, host=host, port=port
        )
        connection.autocommit = True
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

        logger.info(f"Successfully executed {file_path}")
        return True
    except Error as e:
        logger.error(f"Error executing {file_path}: {e}")
        return False
    finally:
        if cursor:
            cursor.close()


def insert_admin_user(db, username, password, email, first_name, last_name):
    if not db:
        logger.error("Failed to connect to the database")
        return False

    logger.info(f"Inserting admin user: {username}")
    logger.info(f"Password: {password}")

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
        return False
    finally:
        if cursor:
            cursor.close()


def check_tables_exist(db):
    """Check if all required tables exist in the database."""
    if not db:
        logger.error("Failed to connect to the database")
        return False

    # Get all required tables from our configuration
    required_tables = set(TABLE_FILE_MAP.keys())

    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute(
            """SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public'"""
        )
        existing_tables = {row[0] for row in cursor.fetchall()}

        missing_tables = required_tables - existing_tables

        if missing_tables:
            logger.warning(f"Missing tables: {sorted(missing_tables)}")
            return False

        logger.info(f"All {len(required_tables)} required tables exist")
        return True
    except Error as e:
        logger.warning(f"Error checking tables exist: {e}")
        return False
    finally:
        if cursor:
            cursor.close()


def get_missing_tables(db):
    """Get the set of missing tables."""
    if not db:
        return set()

    required_tables = set(TABLE_FILE_MAP.keys())

    cursor = None
    try:
        cursor = db.cursor()
        cursor.execute(
            """SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public'"""
        )
        existing_tables = {row[0] for row in cursor.fetchall()}
        return required_tables - existing_tables
    except Error as e:
        logger.warning(f"Error getting missing tables: {e}")
        return required_tables
    finally:
        if cursor:
            cursor.close()


def create_tables_from_decomposed_files(db, tables_to_create, owner):
    """Create tables by reading from individual SQL files in dependency order."""
    if not db or not tables_to_create:
        return True

    num_tables = len(tables_to_create)
    if num_tables == len(TABLE_FILE_MAP):
        logger.info(f"Creating all {num_tables} tables from decomposed files")
    else:
        logger.info(f"Creating {num_tables} missing tables: {sorted(tables_to_create)}")

    # Get the execution order for the tables to create
    ordered_files = get_execution_order_for_tables(tables_to_create)

    # Also need to include the update function if user_preferences is being created
    if "user_preferences" in tables_to_create:
        # Add the function file if not already included
        function_file = "functions/update_updated_at_column.sql"
        if function_file not in ordered_files:
            ordered_files.insert(0, function_file)

    cursor = db.cursor()

    for relative_file_path in ordered_files:
        try:
            file_path = SQL_DIR / relative_file_path

            if not file_path.exists():
                logger.error(f"SQL file not found: {file_path}")
                return False

            logger.info(f"Executing SQL file: {relative_file_path}")

            # Read and execute the SQL file
            with open(file_path, "r") as file:
                sql_content = file.read()

            # Replace the owner placeholder
            sql_content = sql_content.format(owner=owner)

            cursor.execute(sql_content)
            logger.info(f"Successfully executed: {relative_file_path}")
        except Error as e:
            logger.error(f"Error executing SQL file: {e}")

    return True


@click.command()
@click.option("--dbname", type=str, required=True)
@click.option("--user", type=str, required=True)
@click.option("--password", type=str, required=True)
@click.option("--host", type=str, required=True)
@click.option("--port", type=int, required=True)
@click.option("--email", type=str, required=True)
@click.option("--first_name", type=str, required=True)
@click.option("--last_name", type=str, required=True)
def main(dbname, user, password, host, port, email, first_name, last_name):
    db = None
    try:
        db = connect_to_db(
            dbname=dbname, user=user, password=password, host=host, port=port
        )
        if not db:
            return

        tables_exist = check_tables_exist(db)
        logger.info(f"All tables exist: {tables_exist}")

        if not tables_exist:
            missing_tables = get_missing_tables(db)

            # Always use the decomposed files approach
            logger.info("Using decomposed SQL files to create tables")
            if not create_tables_from_decomposed_files(db, missing_tables, user):
                return

        users_exist = check_users_exist(db)
        logger.info(f"Users exist: {users_exist}")
        if not users_exist:
            logger.info("Inserting admin user")
            if not insert_admin_user(db, user, password, email, first_name, last_name):
                return
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")
    finally:
        if db:
            db.close()
            logger.info("Database connection closed")


if __name__ == "__main__":
    main()
