# Decomposed SQL Schema Structure

This directory contains the database schema split into logical components for better maintainability and selective execution.

## Directory Structure

```
sql_scripts/
├── functions/                     # Database functions
│   └── update_updated_at_column.sql
├── tables/
│   ├── core/                      # Core system tables
│   │   ├── users.sql              # User accounts and authentication
│   │   └── user_preferences.sql   # User settings and preferences
│   ├── auth/                      # Authentication and security
│   │   ├── invite_codes.sql       # Registration invite codes
│   │   └── password_reset_tokens.sql # Password reset functionality
│   ├── content/                   # User-generated content
│   │   ├── annotations.sql        # File annotations
│   │   ├── favorite_files.sql     # User favorite files
│   │   ├── help_tickets.sql       # User support tickets
│   │   └── signup_requests.sql    # Account registration requests
│   ├── edf/                       # EDF file related tables
│   │   ├── edf_configs.sql        # EDF file configurations
│   │   └── edf_config_channels.sql # EDF channel configurations
│   ├── artifacts/                 # Artifact management
│   │   ├── artifacts.sql          # Artifact metadata
│   │   └── artifact_shares.sql    # Artifact sharing permissions
│   └── layouts/                   # UI layout storage
│       └── user_layouts.sql       # User interface layouts
├── table_config.py               # Table dependency configuration
├── schema.sql                    # Legacy monolithic schema (kept for reference only)
└── insert_admin_user.sql         # Admin user creation script
```

## Key Features

### 1. Dependency Management
The `table_config.py` file defines:
- **Execution order**: Tables are created in dependency order
- **File mapping**: Maps table names to their SQL files
- **Selective execution**: Only missing tables are created

### 2. Modular Design
Each table is defined in its own file, including:
- Table definition
- Sequences (for auto-incrementing IDs)
- Indexes
- Constraints
- Foreign key relationships
- Comments and documentation

### 3. Fully Decomposed Approach
- **All scenarios**: Uses decomposed files for both full and partial deployment
- **No monolithic dependency**: The `schema.sql` file is kept for reference only
- **Dynamic execution**: Always determines the optimal creation order

## Usage

### Creating Tables
The `apply_sql_files.py` script automatically:
1. Detects missing tables
2. Determines execution order based on dependencies
3. Creates only the missing tables in the correct order
4. **Uses decomposed files for all scenarios** (empty database or partial deployment)

### Adding New Tables
1. Create a new SQL file in the appropriate subdirectory
2. Add the table name and file path to `TABLE_FILE_MAP` in `table_config.py`
3. Add the file to `TABLE_EXECUTION_ORDER` respecting dependencies

### Example: Adding a New Table
```python
# In table_config.py
TABLE_FILE_MAP = {
    # ... existing mappings ...
    "new_table": "tables/category/new_table.sql",
}

TABLE_EXECUTION_ORDER = [
    # ... existing order ...
    "tables/category/new_table.sql",  # Add after dependencies
]
```

## Dependency Graph

```
Functions
└── update_updated_at_column.sql

Core Tables
└── users.sql
    ├── user_preferences.sql (+ update_updated_at_column function)
    ├── password_reset_tokens.sql
    ├── invite_codes.sql
    ├── annotations.sql
    ├── favorite_files.sql
    ├── help_tickets.sql
    ├── signup_requests.sql
    ├── edf_configs.sql
    │   └── edf_config_channels.sql
    ├── artifacts.sql
    │   └── artifact_shares.sql
    └── user_layouts.sql
```

## Benefits

1. **Maintainability**: Each table is self-contained and easier to modify
2. **Selective deployment**: Only missing tables are created
3. **Dependency safety**: Tables are created in the correct order
4. **Version control**: Changes to individual tables are easier to track
5. **Testing**: Individual tables can be tested in isolation
6. **Documentation**: Each file can contain table-specific documentation
7. **No hardcoding**: All SQL is dynamically loaded from files
8. **Consistent approach**: Same logic for empty and partially populated databases

## Deployment Scenarios

The system handles all scenarios using the decomposed files:

### Empty Database
- Detects all tables are missing
- Creates all tables from decomposed files in dependency order
- Logs: "Creating all 13 tables from decomposed files"

### Partial Database
- Detects specific missing tables
- Creates only missing tables in dependency order
- Logs: "Creating N missing tables: [table_names]"

### Fully Populated Database
- Detects no missing tables
- Skips table creation
- Proceeds to user creation if needed

## Legacy Files

- **`schema.sql`**: Kept for reference and manual operations only
- **Not used by Python code**: The application exclusively uses decomposed files
- **Maintenance**: Should be updated manually if needed for reference purposes

This ensures a fully modular, maintainable, and consistent approach to database schema management.
