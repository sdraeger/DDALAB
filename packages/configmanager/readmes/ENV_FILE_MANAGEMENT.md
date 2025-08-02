# Environment File Management

This document explains the new environment file management system implemented to prevent environment variables from being baked into Docker containers.

## Overview

The configmanager now generates separate environment files for API and web containers instead of mounting the main `.env` file directly. This ensures:

1. Environment variables are not baked into container images
2. Each container receives only the environment variables it needs
3. Better security and isolation between services
4. Proper cleanup when containers are stopped

## How It Works

### 1. Environment File Generation

When starting Docker containers, the configmanager:

1. Reads the base environment file (`.env`, `.env.development`, etc.)
2. Categorizes variables into:
   - **API-specific**: Variables starting with `DDALAB_`, database config, etc.
   - **Web-specific**: Variables starting with `NEXT_`, web ports, etc.
   - **Shared**: Common variables needed by both services
3. Generates two separate files:
   - `.env.api` - Contains shared + API-specific variables
   - `.env.web` - Contains shared + web-specific variables

### 2. Docker Compose Integration

The `docker-compose.yml` has been updated to:

- Use `env_file: ./.env.api` for the API service
- Use `env_file: ./.env.web` for the web service
- Remove direct mounting of `.env` files into containers

### 3. Cleanup

When stopping Docker containers, the generated environment files are automatically cleaned up to avoid leaving temporary files.

## Variable Categories

### API-Specific Variables

- `DDALAB_*` (all DDALAB prefixed variables)
- `DDALAB_MINIO_*`
- `DDALAB_REDIS_*`
- `DDALAB_PLOT_CACHE_TTL`
- `DDALAB_ALLOWED_DIRS`
- `PROMETHEUS_MULTIPROC_DIR`

### Web-Specific Variables

- `NEXT_*` (all Next.js prefixed variables)
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`
- `WEB_PORT`
- `NODE_ENV`

### Shared Variables

- Database configuration (`DDALAB_DB_*`)
- MinIO credentials (`MINIO_ROOT_*`)
- Session configuration
- Traefik configuration

## Benefits

1. **Security**: Containers only receive necessary environment variables
2. **Isolation**: Better separation between API and web environments
3. **Clean Images**: Environment variables are not baked into container images
4. **Flexibility**: Easy to modify which variables go to which container
5. **Debugging**: Separate files make it easier to debug environment issues

## Files Generated

- `.env.api` - Temporary file for API container (auto-cleaned)
- `.env.web` - Temporary file for web container (auto-cleaned)
- `docker-compose.volumes.yml` - Volume configuration (existing)

## Implementation Details

See `packages/configmanager/src/services/env-generator-service.ts` for the implementation details of environment file generation and cleanup.
