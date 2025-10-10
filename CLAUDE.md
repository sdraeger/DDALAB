# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style

Always write code by the SOLID principles of Software Engineering. Always write modular and maintainable code. Avoid redefinitions of constants.

## Project Overview

DDALAB (Delay Differential Analysis Laboratory) is a scientific computing application for performing Delay Differential Analysis on EDF and ASCII files. It uses a microservices architecture with:

- Python FastAPI backend with GraphQL
- Multiple React/Next.js frontends
- Electron desktop application (ConfigManager)
- Docker Compose orchestration
- PostgreSQL, Redis, MinIO, Traefik

## Common Development Commands

### Quick Start

```bash
# Development mode (all services)
npm run dev

# Build all packages
npm run build

# Run specific frontend
cd packages/web && npm run dev    # Main web app on port 3000
cd packages/web20 && npm run dev   # Dashboard on port 3000

# Run ConfigManager desktop app
npm run dev:configmanager
npm run start:configmanager
```

### Python Backend Development

```bash
# Run tests
pytest

# Run specific test
pytest tests/test_specific.py::test_function_name

# Run with coverage
pytest --cov=ddalab --cov=server

# Lint Python code
ruff check .
ruff format .

# Type checking
mypy ddalab server
```

### Frontend Testing & Linting

```bash
# In any frontend package (web, web20)
npm run test
npm run test:watch
npm run test:coverage
npm run lint
npm run typecheck
```

### Docker Operations

```bash
# Development mode - API backend only for Tauri app
docker-compose -f docker-compose.api-only.yml up --build -d

# Production mode - Full stack with web interface
docker-compose up --build -d

# View logs
docker-compose logs -f [service_name]

# Stop services
docker-compose down
# or for API-only development:
docker-compose -f docker-compose.api-only.yml down

# Build Docker API image
docker build -f Dockerfile.api -t ddalab-api:latest .
```

### ConfigManager Packaging

```bash
# Development builds
npm run package:dev:mac
npm run package:dev:win
npm run package:dev:linux

# Production builds
npm run package:prod:mac
npm run package:prod:win
npm run package:prod:linux

# Publish to GitHub releases
npm run publish:dev:all
npm run publish:prod:all
```

## Architecture & Key Patterns

### Monorepo Structure

- Uses npm workspaces with Turbo for build orchestration
- Packages in `packages/` directory share dependencies
- `packages/shared` contains cross-package components

### State Management Architecture

**IMPORTANT**: Do NOT modify state management code without explicit permission (per .cursor/rules).

- Redux Toolkit for global state in web packages
- XState for complex state machines (ConfigManager)
- React Context for theme and authentication
- Widget state persistence in localStorage

### Docker Services Architecture

```yaml
Services:
  - ddalab: Main Python API server
  - postgres: Database
  - redis: Caching/sessions
  - minio: Object storage for EDF files
  - traefik: Reverse proxy with SSL
  - prometheus/grafana: Monitoring
```

### Frontend Architecture Patterns

1. **Widget-based Dashboard**:
   - React Grid Layout for drag-and-drop
   - Widget components in `components/widgets/`
   - Layout persistence in user preferences

2. **Pop-out Windows**:
   - Cross-window authentication sync
   - Shared state via broadcast channels
   - Window-specific Redux stores

3. **File Processing Pipeline**:
   - Upload to MinIO → Queue in Redis → Store results in PostgreSQL

### API Architecture

- REST endpoints via FastAPI
- GraphQL via Strawberry for complex queries
- WebSocket subscriptions for real-time updates
- Authentication via JWT tokens

## Development Workflow

### Adding New Features

1. Frontend changes: Work in appropriate package (ddalab-tauri)
2. Backend changes: Modify Rust code in packages/ddalab-tauri/src-tauri/src
3. Run tests before committing
4. Use feature branches and PRs

### Testing Requirements

- Frontend: Jest + React Testing Library
- Backend: Rust tests with `cargo test`
- Integration tests for critical paths
- Run tests: `npm run test` (frontend) or `cargo test` (backend)

### Environment Configuration

- **New System**: `.env.master` as single source of truth
- **Generated configs**: Use `npm run deploy:dev` or `npm run deploy:prod`
- **Validation**: `npm run config:validate` for configuration checks
- **ConfigManager**: Integrated with unified configuration system
- SSL certificates in `certs/` directory

## Important Conventions

### Code Style

- TypeScript for all frontend code
- Python type hints required
- Follow existing patterns in neighboring files
- Use Radix UI components consistently
- No comments unless specifically requested

### Security

- All traffic encrypted via Traefik SSL
- JWT authentication for API access
- Environment isolation for sensitive data
- Never commit secrets or certificates

### File Naming

- React components: PascalCase.tsx
- Utilities: camelCase.ts
- Python modules: snake_case.py
- Test files: \_.test.ts or test\_\_.py

## Critical Notes

1. **State Management**: Do not modify without permission
2. **Docker Compose**: Primary deployment method
3. **SSL Required**: Application expects HTTPS everywhere
4. **Data Privacy**: All processing happens locally by default
5. **Scientific Accuracy**: DDA algorithms are core - test thoroughly
