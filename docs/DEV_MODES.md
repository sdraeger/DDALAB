# Development Modes

DDALAB offers multiple ways to run the development environment:

## 1. Full Docker Development (Recommended)

**Command**: `npm run dev:docker` or `./scripts/dev.sh up`

**What it starts**:
- PostgreSQL, Redis, MinIO
- API server (with hot reload)
- Web20 dashboard (with hot reload)
- Traefik (reverse proxy)
- Prometheus (metrics)
- Grafana (visualization)
- Jaeger (tracing)

**Use when**: You want the complete development environment with observability and routing.

## 2. Minimal Docker Development

**Command**: `npm run dev:docker:minimal` or `./scripts/dev-minimal.sh up`

**What it starts**:
- PostgreSQL, Redis, MinIO
- API server (with hot reload)
- Web20 dashboard (with hot reload)

**Use when**: You want containerized development but without the monitoring stack.

## 3. Local Development

**Commands**:
- `npm run dev:local` - Start API + Web20 (requires core services running)
- `npm run dev:local:auto` - Start core services + API + Web20 automatically
- `npm run dev:local:concurrent` - Alternative using concurrently package

**What it starts**:
- API server via `packages/api/start.sh`
- Web20 via `npm run dev` in `packages/web20`
- Optionally starts PostgreSQL, Redis, MinIO with `--start-services`

**Use when**: You want to run services locally for debugging or development outside containers.

## 4. Core Services Only

**Commands**:
```bash
# Start core services (PostgreSQL, Redis, MinIO)
npm run services:start

# Stop core services
npm run services:stop

# Check core services status
npm run services:status
```

**Use when**: You want to run API and Web20 locally but need the database and storage services.

## 5. Individual Services

**Commands**:
```bash
# API only (requires core services)
cd packages/api && ./start.sh

# Web20 only
cd packages/web20 && npm run dev

# Core services only
npm run services:start
```

**Use when**: You only need specific services for development or testing.

## Service URLs

| Service | Full Docker | Minimal Docker | Local |
|---------|-------------|----------------|-------|
| Web20 Dashboard | http://localhost:3000 | http://localhost:3000 | http://localhost:3000 |
| API Server | http://localhost:8001 | http://localhost:8001 | http://localhost:8001 |
| API Docs | http://localhost:8001/docs | http://localhost:8001/docs | http://localhost:8001/docs |
| MinIO Console | http://localhost:9001 | http://localhost:9001 | http://localhost:9001 |
| Traefik Dashboard | http://localhost:8080 | ❌ | ❌ |
| Prometheus | http://localhost:9090 | ❌ | ❌ |
| Grafana | http://localhost:3000 | ❌ | ❌ |
| Jaeger | http://localhost:16686 | ❌ | ❌ |

## Stopping Services

| Mode | Stop Command |
|------|-------------|
| Full Docker | `./scripts/dev.sh down` |
| Minimal Docker | `./scripts/dev-minimal.sh down` |
| Local | `Ctrl+C` (if using concurrently) |

## Development Features

### Hot Reload
- ✅ **API**: All modes support hot reload via uvicorn
- ✅ **Web20**: All modes support Next.js hot reload

### Debugging
- **Python**: Port 5678 exposed in Docker modes
- **Node.js**: Standard Next.js debugging available
- **Database**: Direct access via port 5432 in all modes

### Volume Mounts
Docker modes mount:
- `./packages/api` → `/app/packages/api` (API hot reload)
- `./packages/web20` → `/app/packages/web20` (Web20 hot reload)
- `./data` → `/app/data` (Data persistence)

## Choosing the Right Mode

**For daily development**: Use `npm run dev:docker` - gives you the full stack with observability.

**For quick testing**: Use `npm run dev:docker:minimal` - faster startup, fewer resources.

**For debugging issues**: Use `npm run dev:local` - direct access to processes and logs.

**For specific work**: Start individual services as needed.

## Environment Variables

All modes read from:
1. `.env` - Base configuration
2. `.env.local` - Local overrides (if exists)

The direnv setup automatically loads these when you `cd` into the project.
