# DDALAB Docker Configuration System

This document describes the robust configuration system for the DDALAB Docker container, designed to ensure the container always starts successfully while allowing flexible user overrides.

## Configuration Precedence

The configuration system follows a strict precedence order:

1. **Environment Variables** (highest priority)
2. **Mounted Config File** (medium priority)
3. **Baked-in Default Config** (lowest priority, always available)

## Usage Examples

### 1. Default Operation (No Configuration Needed)

The container will start successfully with no additional configuration:

```bash
docker run -p 8001:8001 -p 3000:3000 ddalab:latest
```

Uses: `/etc/ddalab/config.yml` (baked-in default)

### 2. Environment Variable Override

Set specific configuration via environment variables:

```bash
docker run -p 8001:8001 -p 3000:3000 \
  -e DDA_MODE=development \
  -e DDA_PORT=8002 \
  -e DDA_DB_HOST=my-postgres-host \
  -e DDA_DEBUG=true \
  ddalab:latest
```

This generates a runtime configuration from environment variables.

### 3. Mounted Configuration File

Mount a custom configuration file:

```bash
docker run -p 8001:8001 -p 3000:3000 \
  -v /path/to/my-config.yml:/config/config.yml:ro \
  ddalab:latest
```

Uses: `/config/config.yml` (your mounted file)

### 4. Docker Compose with Environment Variables

```yaml
version: '3.8'
services:
  ddalab:
    image: ddalab:latest
    ports:
      - "8001:8001"
      - "3000:3000"
    environment:
      - DDA_MODE=production
      - DDA_DB_HOST=postgres
      - DDA_REDIS_HOST=redis
      - DDA_MINIO_HOST=minio:9000
      - DDA_DATA_DIR=/app/data
    depends_on:
      - postgres
      - redis
      - minio
```

### 5. Docker Compose with Mounted Config

```yaml
version: '3.8'
services:
  ddalab:
    image: ddalab:latest
    ports:
      - "8001:8001" 
      - "3000:3000"
    volumes:
      - ./my-config.yml:/config/config.yml:ro
      - ./data:/app/data
```

## Environment Variables Reference

All environment variables use the `DDA_` prefix:

### Core Settings
- `DDA_MODE` - deployment mode (development/production)
- `DDA_PORT` - API server port (default: 8001)
- `DDA_DEBUG` - enable debug mode (true/false)
- `DDA_ENVIRONMENT` - environment name
- `DDA_SERVICE_NAME` - service identifier

### API Configuration
- `DDA_API_HOST` - API bind address (default: 0.0.0.0)
- `DDA_API_PORT` - API port (default: 8001)
- `DDA_RELOAD` - enable auto-reload (true/false)

### Database Configuration
- `DDA_DB_HOST` - database hostname (default: postgres)
- `DDA_DB_PORT` - database port (default: 5432)
- `DDA_DB_NAME` - database name (default: ddalab)
- `DDA_DB_USER` - database username
- `DDA_DB_PASSWORD` - database password

### Storage Configuration
- `DDA_MINIO_HOST` - MinIO hostname:port
- `DDA_MINIO_ACCESS_KEY` - MinIO access key
- `DDA_MINIO_SECRET_KEY` - MinIO secret key
- `DDA_DATA_DIR` - data directory path (default: /app/data)
- `DDA_ALLOWED_DIRS` - allowed directories (comma-separated)

### DDA Engine Configuration
- `DDA_BINARY_PATH` - path to DDA binary (default: /app/bin/run_DDA_ASCII)
- `DDA_MAX_CONCURRENT_TASKS` - max concurrent DDA tasks
- `DDA_TASK_TIMEOUT` - task timeout in seconds

### Web Frontend Configuration
- `DDA_PUBLIC_API_URL` - public API URL for frontend
- `DDA_PUBLIC_APP_URL` - public app URL
- `DDA_WEB_PORT` - web server port (default: 3000)

## Configuration File Format

The configuration files use YAML format. Example:

```yaml
# DDALAB Configuration
environment: production
debug: false
service_name: ddalab

api:
  host: 0.0.0.0
  port: 8001
  reload: false

database:
  host: postgres
  port: 5432
  name: ddalab
  user: admin
  password: secure_password

storage:
  minio_host: minio:9000
  minio_access_key: minioadmin
  minio_secret_key: minioadmin
  data_dir: /app/data
  allowed_dirs: /app/data

dda:
  binary_path: /app/bin/run_DDA_ASCII
  max_concurrent_tasks: 10
  task_timeout: 600
```

## Troubleshooting

### Container Won't Start

If the container fails to start:

1. **Check logs**: `docker logs <container_id>`
2. **Verify mounted config**: Ensure mounted config files are readable
3. **Test with defaults**: Try running without any config overrides
4. **Check environment variables**: Verify env var names and values

### Configuration Not Applied

1. **Check precedence**: Higher priority configs override lower ones
2. **Verify syntax**: YAML files must be valid
3. **Check file permissions**: Mounted files must be readable by container user
4. **Review logs**: Configuration resolution is logged during startup

### Common Issues

- **Permission denied**: Mounted config files need appropriate permissions
- **Invalid YAML**: Syntax errors in configuration files
- **Wrong paths**: Ensure data directories and binary paths are correct
- **Port conflicts**: Check for port conflicts on host system

## Deployment Recommendations

### Development
Use environment variables for quick testing:
```bash
docker run -e DDA_MODE=development -e DDA_DEBUG=true ddalab:latest
```

### Staging/Production  
Use mounted configuration files for full control:
```bash
docker run -v /etc/ddalab/prod-config.yml:/config/config.yml:ro ddalab:latest
```

### CI/CD
The container will always start with defaults, making it safe for automated deployments.

## Security Considerations

- **Secrets**: Use Docker secrets or external secret management for sensitive values
- **File permissions**: Ensure mounted config files have appropriate permissions
- **Network access**: Configure firewall rules for exposed ports
- **Data persistence**: Mount data volumes for persistent storage

## Migration from Legacy System

The new system maintains backward compatibility with the existing `.env` based system. The container will:

1. Load the appropriate configuration using the precedence rules
2. Convert settings to environment variables for backward compatibility
3. Start the application using the existing startup scripts

No changes to existing Docker Compose files are required unless you want to take advantage of the new features.