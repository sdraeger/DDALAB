# Development Environment Setup

This guide covers setting up a consistent development environment for DDALAB.

## Quick Start

Run the automated setup script:

```bash
./scripts/setup-dev-env.sh
```

## Manual Setup

### 1. Install Prerequisites

#### Required:
- Docker Desktop
- Node.js 20.x
- Python 3.10+

#### Recommended:
- Volta (Node version management)
- direnv (Environment variable management)
- VS Code with DevContainers extension

### 2. Node Version Management

#### Option A: Volta (Recommended)
```bash
# Install Volta
curl https://get.volta.sh | bash

# Volta will automatically use the correct Node version
# specified in package.json when you enter the project
```

#### Option B: nvm
```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Use Node 20
nvm install 20
nvm use 20
```

### 3. Environment Variables with direnv

```bash
# Install direnv (macOS)
brew install direnv

# Add to your shell (~/.zshrc or ~/.bashrc)
eval "$(direnv hook zsh)"  # or bash

# Allow direnv in the project
cd /path/to/ddalab
direnv allow
```

### 4. Docker Compose Profiles

We use Docker Compose profiles to separate development and production environments:

```bash
# Start only core services (postgres, redis, minio)
./scripts/docker-profiles.sh core

# Start development environment
./scripts/docker-profiles.sh dev

# Start with development tools (pgAdmin, Redis Commander)
./scripts/docker-profiles.sh all-dev

# Start production environment
./scripts/docker-profiles.sh prod

# Stop all services
./scripts/docker-profiles.sh stop
```

### 5. VS Code DevContainers

For a fully containerized development environment:

1. Install VS Code and the "Dev Containers" extension
2. Open the project in VS Code
3. Click "Reopen in Container" when prompted
4. VS Code will build and start the development container

## Environment Configuration

### .env Files

- `.env` - Base configuration (committed to git)
- `.env.local` - Local overrides (not committed)
- `.envrc` - direnv configuration (not committed)

### Example .env.local

```bash
# Development settings
NODE_ENV=development
DDALAB_AUTH_MODE=local

# Service URLs
DATABASE_URL=postgresql://ddalab:ddalab@localhost:5432/ddalab
REDIS_URL=redis://localhost:6379
MINIO_URL=http://localhost:9000

# API Configuration
API_PORT=8001
NEXT_PUBLIC_API_URL=http://localhost:8001
```

## Common Tasks

### Start Development

#### Option 1: Docker Development (Recommended)
```bash
# Start all services with Docker
npm run dev:docker

# Or use the script directly
./scripts/dev.sh up

# View logs
./scripts/dev.sh logs

# Access specific service logs
./scripts/dev.sh logs api
./scripts/dev.sh logs web20

# Stop services
./scripts/dev.sh down
```

#### Option 2: Local Development
```bash
# With direnv (automatic environment loading)
cd /path/to/ddalab
npm run dev:local

# Without direnv
source .env && source .env.local && npm run dev:local

# Or run services individually:
# Terminal 1 - API
cd packages/api && ./start.sh

# Terminal 2 - Web20
cd packages/web20 && npm run dev
```

### Access Services

- **Web App**: http://localhost:3000
- **Dashboard**: http://localhost:3001
- **API**: http://localhost:8001
- **API Docs**: http://localhost:8001/docs
- **MinIO Console**: http://localhost:9001
- **pgAdmin**: http://localhost:5050 (if using dev-tools profile)
- **Redis Commander**: http://localhost:8081 (if using dev-tools profile)

### Python Development

```bash
# Activate virtual environment
cd packages/api
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run tests
pytest

# Format code
ruff format .
```

### Node.js Development

```bash
# Install dependencies
npm install

# Run specific package
npm run dev -w packages/web

# Run tests
npm test

# Build all packages
npm run build
```

## Troubleshooting

### Port Conflicts
If you get port already in use errors:
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Docker Issues
```bash
# Reset Docker environment
docker-compose down -v
docker system prune -a

# Rebuild from scratch
./scripts/docker-profiles.sh clean
./scripts/docker-profiles.sh dev
```

### Node Version Issues
```bash
# With Volta
volta install node@20

# With nvm
nvm use 20
```

### Permission Issues
```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

## VS Code Settings

Recommended VS Code settings are included in `.devcontainer/devcontainer.json` and will be automatically applied when using DevContainers.

For local development, install these extensions:
- ESLint
- Prettier
- Python
- Pylance
- Docker
- PostgreSQL
- Thunder Client (API testing)
- Error Lens
- GitLens