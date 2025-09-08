#!/bin/sh
# Docker entrypoint script with secret support

# Function to export secret from file if it exists
export_secret() {
    var_name="$1"
    file_var="${var_name}_FILE"
    file_path=$(eval echo \$${file_var})
    
    if [ -n "$file_path" ] && [ -f "$file_path" ]; then
        export "$var_name"=$(cat "$file_path")
        echo "Loaded $var_name from $file_path"
    fi
}

# Export all secrets
export_secret "DB_PASSWORD"
export_secret "JWT_SECRET_KEY"
export_secret "MINIO_ACCESS_KEY"
export_secret "MINIO_SECRET_KEY"
export_secret "NEXTAUTH_SECRET"

# Execute the main command
exec "$@"