# Isolated Development Environment

This isolated development environment provides a completely self-contained DDALAB setup with:

- **Zero contamination** from host environment variables
- **Fast hot-reload** for both API and frontend
- **Consistent behavior** between development and production
- **Non-conflicting ports** to run alongside other services

## Quick Start

```bash
# Start the isolated environment
./scripts/dev-isolated.sh up

# View logs
./scripts/dev-isolated.sh logs

# Stop the environment
./scripts/dev-isolated.sh down
```

## Features

### Complete Isolation
- All services run in Docker containers with fixed configurations
- No dependency on host environment variables
- Separate ports to avoid conflicts with existing services
- Isolated volumes for data persistence

### Fast Development
- **API Hot Reload**: Python files are mounted and uvicorn runs with `--reload`
- **Frontend Hot Reload**: Next.js dev server with fast refresh
- **Cached Mounts**: Uses Docker's cached mount option for better performance
- **Optimized Dockerfile**: Multi-stage build with dependency caching

### Service Ports
- **Web20 Frontend**: http://localhost:3002
- **API Server**: http://localhost:8002
- **PostgreSQL**: localhost:5433
- **Redis**: localhost:6380
- **MinIO**: localhost:9002 (console: localhost:9003)
- **Traefik**: localhost:8081 (dashboard)

### Fixed Credentials
All credentials are hardcoded for the isolated environment:
- **Database**: `ddalab_dev` / `isolated_dev_pass`
- **MinIO**: `isolated_minio` / `isolated_minio_pass`
- **JWT Secret**: `isolated_dev_jwt_secret_key_32chars`

## Architecture

```
┌─────────────────────────────────────────────────┐
│           Isolated Docker Network               │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  Web20  │  │   API   │  │ Traefik │        │
│  │  :3002  │  │  :8002  │  │  :8443  │        │
│  └─────────┘  └─────────┘  └─────────┘        │
│       │            │                            │
│       └────────────┴───────────┐               │
│                                │               │
│  ┌──────────┐  ┌─────────┐  ┌─────────┐      │
│  │ PostgreSQL│  │  Redis  │  │  MinIO  │      │
│  │   :5433   │  │  :6380  │  │  :9002  │      │
│  └──────────┘  └─────────┘  └─────────┘      │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Benefits

1. **No Environment Conflicts**: Completely isolated from system environment
2. **Reproducible**: Same environment every time
3. **Fast Iteration**: Hot reload for immediate feedback
4. **Production-like**: Uses same Docker setup as production
5. **Easy Cleanup**: Single command to remove everything

## Comparison with Other Dev Modes

| Feature | Isolated Dev | Local Dev | Docker Compose Dev |
|---------|-------------|-----------|-------------------|
| Environment Isolation | ✅ Complete | ❌ Uses host env | ⚠️ Partial |
| Hot Reload | ✅ Yes | ✅ Yes | ❌ No |
| Port Conflicts | ✅ Avoided | ⚠️ Possible | ⚠️ Possible |
| Setup Speed | ✅ Fast | ⚠️ Manual setup | ✅ Fast |
| Cleanup | ✅ Easy | ❌ Manual | ✅ Easy |