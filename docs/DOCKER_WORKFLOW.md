# Docker Workflow Documentation

This document describes the automated Docker build and deployment workflow for the DDALAB API.

## Overview

The DDALAB API is automatically built and pushed to Docker Hub whenever changes are pushed to the repository. The workflow builds multi-architecture images supporting both AMD64 and ARM64 platforms.

## Docker Hub Repository

The API images are published to: `sdraeger1/ddalab-api`

## Workflow Triggers

The Docker build workflow (`docker-api.yml`) triggers on:

1. **Push to main or develop branches** when changes are made to:
   - `packages/api/**` - API source code
   - `docker/api/**` - Docker configuration
   - `docker-compose.yml` - Docker Compose configuration
   - `.github/workflows/docker-api.yml` - The workflow itself

2. **Pull requests to main** (builds but doesn't push)

3. **Manual trigger** via GitHub Actions UI with optional custom tag

## Image Tags

The workflow creates multiple tags for each build:

- `latest` - Updated on every push to main branch
- `main` / `develop` - Branch-specific tags
- `main-<sha>` / `develop-<sha>` - Branch + commit SHA
- `v1.0.0` - Semantic version tags (when tagged)
- Custom tags (when manually triggered)

## Build Process

1. **Multi-stage Build**
   - Stage 1: Install Python dependencies
   - Stage 2: Create runtime image with minimal footprint

2. **Multi-architecture Support**
   - AMD64 (Intel/AMD processors)
   - ARM64 (Apple Silicon, AWS Graviton)

3. **Security Scanning**
   - Trivy vulnerability scanner runs on each build
   - Results uploaded to GitHub Security tab

4. **Health Checks**
   - Built-in health check endpoint at `/health`
   - Docker HEALTHCHECK configured

## Usage

### Pull Latest Image

```bash
docker pull sdraeger1/ddalab-api:latest
```

### Run with Docker

```bash
docker run -d \
  --name ddalab-api \
  -p 8000:8000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/ddalab" \
  -e SECRET_KEY="your-secret-key" \
  -e MINIO_ENDPOINT="minio:9000" \
  -e MINIO_ACCESS_KEY="minioadmin" \
  -e MINIO_SECRET_KEY="minioadmin" \
  sdraeger1/ddalab-api:latest
```

### Run with Docker Compose

```yaml
services:
  api:
    image: sdraeger1/ddalab-api:latest
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/ddalab
      SECRET_KEY: ${SECRET_KEY}
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: minioadmin
      MINIO_SECRET_KEY: minioadmin
    depends_on:
      - db
      - minio
      - redis
```

## Environment Variables

Required environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - Application secret key
- `MINIO_ENDPOINT` - MinIO/S3 endpoint
- `MINIO_ACCESS_KEY` - MinIO/S3 access key
- `MINIO_SECRET_KEY` - MinIO/S3 secret key

Optional:
- `PORT` - API port (default: 8000)
- `WORKERS` - Number of Uvicorn workers (default: 4)
- `DEBUG` - Enable debug mode (default: false)

## Health Check

The API includes a health check endpoint:

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "ddalab-api",
  "version": "0.0.1"
}
```

## Manual Workflow Trigger

To manually trigger a build with a custom tag:

1. Go to Actions tab in GitHub
2. Select "Build and Push API Docker Image"
3. Click "Run workflow"
4. Enter custom tag (optional)
5. Click "Run workflow"

## Setting Up Secrets

The workflow requires these GitHub secrets:

1. `DOCKER_USERNAME` - Docker Hub username
2. `DOCKER_TOKEN` - Docker Hub access token (not password)

To create a Docker Hub access token:
1. Log in to Docker Hub
2. Go to Account Settings → Security
3. Create New Access Token
4. Copy token to GitHub Secrets

## Monitoring Builds

View build status and logs:
1. Go to Actions tab
2. Click on a workflow run
3. View logs for each job

## Troubleshooting

### Build Fails

Check:
- Python dependency conflicts in requirements.txt
- Dockerfile syntax errors
- GitHub secrets are properly configured

### Image Not Pushed

Ensure:
- Building from main/develop branch (not PR)
- Docker Hub credentials are valid
- No rate limiting from Docker Hub

### Health Check Fails

Verify:
- All required environment variables are set
- Database and dependencies are accessible
- No startup errors in logs

## Security Considerations

1. **Non-root User**: Container runs as non-root user `ddalab`
2. **Minimal Base Image**: Uses `python:3.11-slim`
3. **No Development Dependencies**: Production image excludes dev tools
4. **Regular Scanning**: Trivy scans on every build
5. **Secret Management**: Use proper secret management in production

## Development

To test Docker builds locally:

```bash
# Build for current architecture
docker build -f Dockerfile -t ddalab-api:local .

# Build multi-architecture (requires buildx)
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ddalab-api:local -f Dockerfile .
```