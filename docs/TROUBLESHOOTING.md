# Troubleshooting DDALAB Development

Common issues and solutions for DDALAB development setup.

## Python Package Errors

### Problem
```
ModuleNotFoundError: No module named 'sqlalchemy'
ModuleNotFoundError: No module named 'loguru'
```

### Solution
The Python virtual environment is not set up or activated:

```bash
# Quick fix - setup Python environment
npm run setup:python

# Or run the setup script directly
./scripts/setup-python-env.sh

# Or create manually
cd packages/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The `start.sh` script has been updated to automatically activate the virtual environment.

## concurrently: command not found

### Problem
```
sh: concurrently: command not found
```

### Solution
Install the npm dependencies:

```bash
npm install
```

Or use the shell script version that doesn't need concurrently:
```bash
npm run dev:local  # Uses shell script
```

## Port Already in Use

### Problem
```
Error: listen EADDRINUSE: address already in use :::3000
Error: listen EADDRINUSE: address already in use :::8001
```

### Solution
Find and kill the process using the port:

```bash
# Find what's using the port
lsof -i :3000
lsof -i :8001

# Kill the process (replace PID)
kill -9 <PID>

# Or kill all Node.js processes
pkill -f node
```

## Database Connection Issues

### Problem
```
Connection refused
FATAL: database "ddalab" does not exist
```

### Solution
Start the core database services:

```bash
# Start PostgreSQL, Redis, MinIO
./scripts/docker-profiles.sh core

# Or start minimal Docker setup
npm run dev:docker:minimal
```

## Docker Issues

### Problem
```
Cannot connect to the Docker daemon
```

### Solution
Make sure Docker Desktop is running:
1. Open Docker Desktop
2. Wait for it to start completely
3. Try again

### Problem
```
docker-compose: command not found
```

### Solution
Use the new command format:
```bash
docker compose  # (space, not hyphen)
```

## Environment Variables Not Loading

### Problem
Services can't connect to each other or use wrong configuration.

### Solution
1. **Create .env.local**:
   ```bash
   npm run setup:dev
   ```

2. **Use direnv** (recommended):
   ```bash
   brew install direnv
   # Add to shell: eval "$(direnv hook zsh)"
   direnv allow
   ```

3. **Manual loading**:
   ```bash
   source .env
   source .env.local  # if exists
   ```

## Hot Reload Not Working

### Problem
Changes to code don't trigger restart.

### Solution

**Python API**:
- Make sure uvicorn is running with `--reload` flag
- Check that `packages/api` is mounted in Docker
- Verify virtual environment is activated

**Next.js Web20**:
- Check that `packages/web20` is mounted in Docker
- Make sure Next.js dev server is running (`npm run dev`)
- Clear `.next` cache if needed: `rm -rf packages/web20/.next`

## Permission Denied

### Problem
```
Permission denied: ./scripts/dev.sh
```

### Solution
Make scripts executable:
```bash
chmod +x scripts/*.sh
```

## SSL/TLS Certificate Issues

### Problem
```
certificate verify failed
NODE_TLS_REJECT_UNAUTHORIZED
```

### Solution
For development, TLS verification is disabled. If you see SSL errors:

1. Make sure `.env.local` has:
   ```
   NODE_TLS_REJECT_UNAUTHORIZED=0
   ```

2. For production, generate proper certificates:
   ```bash
   ./scripts/generate-certs.sh
   ```

## Quick Diagnostic Commands

```bash
# Check your setup
npm run check

# Setup everything from scratch
npm run setup:dev

# View all running containers
docker ps

# View Docker logs
./scripts/dev.sh logs

# Test database connection
./scripts/dev.sh db

# Access API container
./scripts/dev.sh api
```

## Getting Help

1. **Check setup**: `npm run check`
2. **View logs**: `./scripts/dev.sh logs [service]`
3. **Reset everything**: Stop all services, run `npm run setup:dev`
4. **Create issue**: If problems persist, create an issue with logs and system info