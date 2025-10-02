# Docker Development Setup

This guide explains the simplified Docker development environment for DDALAB.

## Quick Start

```bash
# Start all services (API + Web20 + dependencies)
./scripts/dev.sh up

# Or use npm
npm run dev:docker
```

This will start:
- PostgreSQL (port 5432)
- Redis (port 6379)
- MinIO (ports 9000/9001)
- API server (port 8001) with hot reload
- Web20 dashboard (port 3000) with hot reload

## Architecture

The `docker-compose.dev.yml` file sets up:

1. **Core Services**:
   - PostgreSQL (port 5432)
   - Redis (port 6379)
   - MinIO (ports 9000/9001)

2. **Application Services**:
   - API Container: Python FastAPI with uvicorn hot reload (port 8001)
   - Web20 Container: Next.js with hot reload (port 3000)

3. **Infrastructure Services**:
   - Traefik: Reverse proxy and load balancer (ports 80/443/8080)
   - Prometheus: Metrics collection (port 9090)
   - Grafana: Metrics visualization (port 3000)
   - Jaeger: Distributed tracing (port 16686)

### Hot Reload

Both API and Web20 support hot reload:
- **API**: Uses `uvicorn --reload` watching `/app/packages/api`
- **Web20**: Uses Next.js dev server with file watching

Your local code is mounted into containers, so changes are reflected immediately.

## Commands

### Service Management

```bash
# Start services
./scripts/dev.sh up

# Stop services
./scripts/dev.sh down

# Restart specific service
./scripts/dev.sh restart api
./scripts/dev.sh restart web20

# View all services status
./scripts/dev.sh status
```

### Logs

```bash
# View all logs
./scripts/dev.sh logs

# View specific service logs
./scripts/dev.sh logs api
./scripts/dev.sh logs web20
./scripts/dev.sh logs postgres

# Follow logs (tail -f)
./scripts/dev.sh logs -f api
```

### Container Access

```bash
# Access API container shell
./scripts/dev.sh api

# Access Web20 container shell
./scripts/dev.sh web20

# Access PostgreSQL
./scripts/dev.sh db

# Execute commands in containers
./scripts/dev.sh exec api pip install requests
./scripts/dev.sh exec web20 npm install lodash
```

### Clean Up

```bash
# Stop and remove all containers/volumes
# WARNING: This deletes all data!
./scripts/dev.sh clean
```

## Environment Variables

The Docker setup reads from:
1. `.env` - Base configuration
2. `.env.local` - Local overrides

Key variables:
```bash
# API
API_PORT=8001
DB_USER=ddalab
DB_PASSWORD=ddalab
DB_NAME=ddalab

# Web20
WEB20_PORT=3000
NODE_ENV=development

# Services
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

## Debugging

### Python Debugging (API)

The API container exposes port 5678 for Python debugging:

```python
# Add this to your code
import debugpy
debugpy.listen(5678)
debugpy.wait_for_client()
```

Then attach your debugger to `localhost:5678`.

### Node.js Debugging (Web20)

Add to your `package.json` dev script:
```json
"dev": "NODE_OPTIONS='--inspect=0.0.0.0:9229' next dev"
```

Then attach your debugger to `localhost:9229`.

## Troubleshooting

### Port Conflicts

If you get "port already in use" errors:
```bash
# Find what's using the port
lsof -i :8001
lsof -i :3000

# Kill the process
kill -9 <PID>
```

### Container Won't Start

Check logs:
```bash
./scripts/dev.sh logs api
./scripts/dev.sh logs web20
```

Common issues:
- Missing dependencies: Check if `requirements.txt` or `package.json` changed
- Database not ready: Wait a few seconds for PostgreSQL to initialize
- Permission issues: Make sure volumes are readable

### Slow Performance

If containers are slow:
1. Increase Docker Desktop memory allocation
2. Exclude `node_modules` and `.next` from file watching
3. Use `.dockerignore` to exclude unnecessary files

### Database Connection Issues

```bash
# Check if PostgreSQL is running
./scripts/dev.sh exec postgres pg_isready

# View PostgreSQL logs
./scripts/dev.sh logs postgres

# Connect manually
./scripts/dev.sh db
```

## Advanced Usage

### Custom Docker Compose

You can extend the setup:
```yaml
# docker-compose.dev.override.yml
services:
  api:
    environment:
      - CUSTOM_VAR=value

  custom-service:
    image: custom:latest
    networks:
      - internal
```

Then run:
```bash
docker compose -f docker-compose.dev.yml -f docker-compose.dev.override.yml up
```

### Production-like Development

To test with production settings:
```bash
# Use the production profile
./scripts/docker-profiles.sh prod
```

## Tips

1. **First Run**: The first run takes longer as it builds images and installs dependencies
2. **Caching**: Dependencies are cached in Docker volumes for faster restarts
3. **Updates**: After updating `requirements.txt` or `package.json`, restart the service
4. **Permissions**: If you have permission issues, check your Docker Desktop file sharing settings
