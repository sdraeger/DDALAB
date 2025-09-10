#!/bin/bash
# Database initialization script
# This runs inside the PostgreSQL container during first startup

set -e

# Ensure the database has proper permissions
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Ensure user owns the database
    ALTER DATABASE $POSTGRES_DB OWNER TO $POSTGRES_USER;
    
    -- Grant all privileges
    GRANT ALL PRIVILEGES ON DATABASE $POSTGRES_DB TO $POSTGRES_USER;
    
    -- Create required extensions
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EOSQL

echo "Database initialization completed"