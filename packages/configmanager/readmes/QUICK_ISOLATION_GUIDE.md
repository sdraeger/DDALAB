# Quick Isolation Guide

## Anti-Contamination Features Implemented ✅

Your configmanager now has comprehensive environment isolation to prevent contamination between development, testing, and production environments.

## Quick Commands

### Environment Management

```bash
# Development mode (default)
npm run start

# Testing mode (isolated)
npm run start:test

# Production mode (isolated)
npm run start:prod

# Create environment files
npm run create:env-files
```

### Environment Detection

```bash
# Check current environment
echo $NODE_ENV
echo $ELECTRON_IS_TESTING
echo $ELECTRON_IS_PRODUCTION
```

## Isolation Features

### 1. Docker Project Isolation ✅

- **Development**: `ddalab-dev-projectname`
- **Testing**: `ddalab-test-projectname`
- **Production**: `ddalab-prod-projectname`

### 2. Environment File Isolation ✅

- **Development**: `.env.development`
- **Testing**: `.env.testing` (different ports)
- **Production**: `.env.production`
- **Fallback**: `.env`

### 3. UserData Folder Isolation ✅

- **Development**: `~/Library/Application Support/DDALAB ConfigManager/development/`
- **Testing**: `~/Library/Application Support/DDALAB ConfigManager/testing/`
- **Production**: `~/Library/Application Support/DDALAB ConfigManager/production/`

### 4. Port Isolation ✅

- **Development**: Web=3000, API=8000, Traefik=80
- **Testing**: Web=4000, API=9000, Traefik=1080
- **Production**: Web=3000, API=8000, Traefik=80

### 5. Volume/Network Isolation ✅

- **Development**: `ddalab_dev_*`, `ddalab_dev_network`
- **Testing**: `ddalab_test_*`, `ddalab_test_network`
- **Production**: `ddalab_prod_*`, `ddalab_prod_network`

## Environment Files Created

### `.env.development`

```bash
NODE_ENV=development
ELECTRON_IS_DEV=true
WEB_PORT=3000
API_PORT=8000
POSTGRES_DB=ddalab_dev
MINIO_ROOT_USER=dev_minio_user
```

### `.env.testing`

```bash
NODE_ENV=test
ELECTRON_IS_TESTING=true
WEB_PORT=4000
API_PORT=9000
POSTGRES_DB=ddalab_test
MINIO_ROOT_USER=test_minio_user
```

### `.env.production`

```bash
NODE_ENV=production
ELECTRON_IS_PRODUCTION=true
WEB_PORT=3000
API_PORT=8000
POSTGRES_DB=ddalab_prod
MINIO_ROOT_USER=prod_minio_user
```

## Verification Commands

### Check Isolation

```bash
# Check UserData directories
ls ~/Library/Application\ Support/DDALAB\ ConfigManager/

# Check Docker projects
docker ps --filter "label=com.docker.compose.project"

# Check Docker volumes
docker volume ls | grep ddalab

# Check Docker networks
docker network ls | grep ddalab
```

### Check Environment

```bash
# Check current mode
npm run start -- --verbose

# Check environment file
cat .env.development
cat .env.testing
cat .env.production
```

## Quick Start

### 1. Create Environment Files

```bash
npm run create:env-files
```

### 2. Update Configuration

```bash
# Edit the generated files with your paths
nano .env.development
nano .env.testing
nano .env.production
```

### 3. Test Isolation

```bash
# Test development mode
npm run start

# Test testing mode (in another terminal)
npm run start:test

# Verify they don't conflict
```

## Troubleshooting

### Port Conflicts

```bash
# Check what's using ports
lsof -i :3000
lsof -i :4000

# Kill conflicting processes
kill -9 <PID>
```

### Docker Conflicts

```bash
# List all Docker resources
docker ps -a
docker volume ls
docker network ls

# Clean up conflicting resources
docker-compose -p ddalab-dev-projectname down --volumes
docker-compose -p ddalab-test-projectname down --volumes
```

### UserData Conflicts

```bash
# Check UserData directories
ls -la ~/Library/Application\ Support/DDALAB\ ConfigManager/

# Remove conflicting data
rm -rf ~/Library/Application\ Support/DDALAB\ ConfigManager/testing/
```

## Environment Variables

### Development

```bash
export NODE_ENV=development
export ELECTRON_IS_DEV=true
```

### Testing

```bash
export NODE_ENV=test
export ELECTRON_IS_TESTING=true
```

### Production

```bash
export NODE_ENV=production
export ELECTRON_IS_PRODUCTION=true
```

## Docker Commands

### Development

```bash
docker-compose -p ddalab-dev-projectname up
docker-compose -p ddalab-dev-projectname down
```

### Testing

```bash
docker-compose -p ddalab-test-projectname up
docker-compose -p ddalab-test-projectname down
```

### Production

```bash
docker-compose -p ddalab-prod-projectname up
docker-compose -p ddalab-prod-projectname down
```

## Benefits

### ✅ **No More Contamination**

- Separate Docker projects per environment
- Isolated UserData folders
- Different environment files
- Port isolation for testing

### ✅ **Easy Environment Switching**

- Simple npm commands
- Automatic environment detection
- Fallback to .env if needed

### ✅ **Safe Testing**

- Testing mode uses different ports
- Separate Docker volumes
- Isolated configuration

### ✅ **Production Safety**

- Production mode is completely isolated
- No risk of development data contamination
- Secure configuration handling

## Quick Reference

| Feature              | Development        | Testing              | Production           |
| -------------------- | ------------------ | -------------------- | -------------------- |
| **Command**          | `npm run start`    | `npm run start:test` | `npm run start:prod` |
| **UserData**         | `~/development/`   | `~/testing/`         | `~/production/`      |
| **Docker Project**   | `ddalab-dev-*`     | `ddalab-test-*`      | `ddalab-prod-*`      |
| **Environment File** | `.env.development` | `.env.testing`       | `.env.production`    |
| **Web Port**         | 3000               | 4000                 | 3000                 |
| **API Port**         | 8000               | 9000                 | 8000                 |
| **Traefik Port**     | 80                 | 1080                 | 80                   |

## Next Steps

1. **Update Environment Files**: Edit the generated `.env.*` files with your actual paths and passwords
2. **Test Isolation**: Run different modes simultaneously to verify isolation
3. **Configure Your Setup**: Copy `.env.template` to `.env` for your specific configuration
4. **Verify**: Use the verification commands to ensure everything is properly isolated

Your configmanager is now fully protected against environment contamination! 🎉
