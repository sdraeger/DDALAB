# DDALAB Docker Configuration

## Overview

This repository contains a simplified Docker setup focused on supporting the DDALAB Tauri desktop application with the necessary backend API services.

## Available Docker Configurations

### 🔧 Development Mode (Tauri App Backend)
**File**: `docker-compose.api-only.yml`

Provides only the backend API services required by the Tauri desktop application:
- **PostgreSQL** database (port 5433)
- **Redis** cache (port 6380) 
- **MinIO** object storage (port 9002)
- **API Server** (port 8000)

```bash
# Start API backend for Tauri development
docker-compose -f docker-compose.api-only.yml up --build -d

# Stop services
docker-compose -f docker-compose.api-only.yml down
```

### 🚀 Production Mode (Full Stack)
**File**: `docker-compose.yml`

Complete DDALAB stack with web interface and all services:
- All API services from development mode
- Web frontend served through Traefik reverse proxy
- SSL termination and routing
- Production optimized configuration

```bash
# Start full production stack
docker-compose up --build -d

# Stop services
docker-compose down
```

### 🐳 API-Only Docker Image
**File**: `Dockerfile.api`

Lightweight Docker image containing only the FastAPI backend:
- Python 3.11 slim base
- FastAPI + dependencies 
- Health checks
- Non-root user security
- Optimized for API-only deployment

```bash
# Build API image locally
docker build -f Dockerfile.api -t ddalab-api:latest .

# Run standalone API container
docker run -p 8000:8000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e SECRET_KEY="your-secret" \
  -e MINIO_ENDPOINT="minio:9000" \
  ddalab-api:latest
```

## Tauri App Development Workflow

1. **Start the API backend**:
   ```bash
   docker-compose -f docker-compose.api-only.yml up -d
   ```

2. **Verify API is running**:
   ```bash
   curl http://localhost:8000/health
   ```

3. **Start Tauri app development**:
   ```bash
   cd packages/ddalab-tauri
   npm run tauri dev
   ```

The Tauri app will connect to the API at `http://localhost:8000` for:
- EDF file processing and management
- DDA analysis computation
- Data persistence and history
- Health monitoring

## API Endpoints

The backend API provides these key endpoints for the Tauri app:

- `GET /health` - Health check
- `GET /api/files/list` - List available EDF files
- `GET /api/edf/info` - Get EDF file metadata
- `GET /api/edf/data` - Get EDF data chunks
- `POST /api/dda` - Submit DDA analysis
- `GET /api/dda/results` - Get analysis results
- `GET /api/dda/history` - Get analysis history

## Data Directories

- `./data/` - EDF files and analysis data (mounted in containers)
- `./bin/` - DDA analysis binaries (mounted read-only)

## Backed Up Files

Previous Docker configurations have been backed up to `.backup/docker-files/` including:
- Legacy web application Docker configs
- E2E testing configurations  
- Docker Swarm stack files
- Multi-environment development setups

These can be restored if needed for web-based deployment scenarios.

## Environment Variables

Key environment variables for configuration:

### Development (API-only)
- `DB_HOST=postgres-dev`
- `DB_PORT=5432` 
- `MINIO_HOST=minio-dev:9000`
- `API_PORT=8001`
- `CORS_ORIGINS=tauri://localhost,http://localhost:3000`

### Production (Full stack)
- `DB_HOST=postgres`
- `MINIO_HOST=minio:9000`
- `DDALAB_AUTH_MODE=local`
- `JWT_SECRET_KEY=[change-in-production]`

## Next Steps

This simplified Docker setup supports the current Tauri desktop application development. For future web deployment needs, the backed up configurations in `.backup/docker-files/` can be restored and adapted as required.