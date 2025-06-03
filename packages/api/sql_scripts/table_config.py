"""
Configuration for table creation order and dependencies.

This file defines the order in which tables should be created to respect
foreign key dependencies.
"""

from pathlib import Path

# Base directory for SQL files
SQL_BASE_DIR = Path(__file__).parent

# Execution order: tables must be created in this order to respect dependencies
TABLE_EXECUTION_ORDER = [
    # Functions first (no dependencies)
    "functions/update_updated_at_column.sql",
    # Core tables (no dependencies except functions)
    "tables/core/users.sql",
    # Tables that depend only on users
    "tables/core/user_preferences.sql",
    "tables/auth/password_reset_tokens.sql",
    "tables/auth/invite_codes.sql",
    "tables/content/annotations.sql",
    "tables/content/favorite_files.sql",
    "tables/content/help_tickets.sql",
    "tables/content/signup_requests.sql",
    "tables/edf/edf_configs.sql",
    "tables/artifacts/artifacts.sql",
    "tables/layouts/user_layouts.sql",
    # Tables that depend on other tables (besides users)
    "tables/edf/edf_config_channels.sql",  # depends on edf_configs
    "tables/artifacts/artifact_shares.sql",  # depends on artifacts
]

# Map table names to their SQL file paths
TABLE_FILE_MAP = {
    "users": "tables/core/users.sql",
    "user_preferences": "tables/core/user_preferences.sql",
    "password_reset_tokens": "tables/auth/password_reset_tokens.sql",
    "invite_codes": "tables/auth/invite_codes.sql",
    "annotations": "tables/content/annotations.sql",
    "favorite_files": "tables/content/favorite_files.sql",
    "help_tickets": "tables/content/help_tickets.sql",
    "signup_requests": "tables/content/signup_requests.sql",
    "edf_configs": "tables/edf/edf_configs.sql",
    "edf_config_channels": "tables/edf/edf_config_channels.sql",
    "artifacts": "tables/artifacts/artifacts.sql",
    "artifact_shares": "tables/artifacts/artifact_shares.sql",
    "user_layouts": "tables/layouts/user_layouts.sql",
}


def get_table_file_path(table_name: str) -> Path:
    """Get the SQL file path for a given table name."""
    if table_name not in TABLE_FILE_MAP:
        raise ValueError(f"Unknown table: {table_name}")
    return SQL_BASE_DIR / TABLE_FILE_MAP[table_name]


def get_execution_order_for_tables(table_names: set) -> list:
    """Get the execution order for a subset of tables."""
    ordered_files = []
    for file_path in TABLE_EXECUTION_ORDER:
        # Extract table name from file path
        table_name = Path(file_path).stem
        if table_name in table_names:
            ordered_files.append(file_path)
    return ordered_files
