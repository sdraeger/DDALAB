# Anti-Contamination Guide

This guide documents the anti-contamination measures implemented in the DDALAB ConfigManager to prevent environment contamination between development, testing, and production environments.

## Overview

The configmanager now implements comprehensive isolation measures to prevent:

- Docker container name conflicts
- Shared volume and network contamination
- Environment file conflicts
- UserData folder contamination
- Port conflicts
- Accidental image rebuilds

## Implemented Fixes

### 1. Docker Container Isolation

**Risk**: Docker containers use same volume or network names
**Fix**: Use `-p` flag for Compose and unique project names

**Implementation**:

```typescript
// Environment-specific project names
static getDockerProjectName(setupPath: string): string {
  const config = this.getCurrentConfig();
  const baseName = path.basename(setupPath).toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${config.dockerProjectPrefix}-${baseName}`;
}

// Isolated Docker Compose commands
static getDockerComposeCommand(setupPath: string): string {
  const config = this.getCurrentConfig();
  const projectName = this.getDockerProjectName(setupPath);
  return `docker-compose -p ${projectName} -f docker-compose.yml -f docker-compose.volumes.yml`;
}
```

**Result**:

- Development: `ddalab-dev-projectname`
- Testing: `ddalab-test-projectname`
- Production: `ddalab-prod-projectname`

### 2. Environment File Isolation

**Risk**: Shared `.env` files between dev and test
**Fix**: Use different `.env.*` files per mode

**Implementation**:

```typescript
static getEnvironmentFilePath(setupPath: string): string {
  const config = this.getCurrentConfig();
  return path.join(setupPath, config.envFile);
}

static async ensureEnvironmentFileExists(setupPath: string): Promise<string> {
  const config = this.getCurrentConfig();
  const envFilePath = this.getEnvironmentFilePath(setupPath);
  const fallbackPath = this.getFallbackEnvironmentFilePath(setupPath);

  // Try mode-specific file first, fallback to .env
  try {
    await fs.access(envFilePath);
    return envFilePath;
  } catch {
    await fs.access(fallbackPath);
    return fallbackPath;
  }
}
```

**Environment Files**:

- `.env.development` - Development configuration
- `.env.testing` - Testing configuration (different ports)
- `.env.production` - Production configuration
- `.env` - Fallback configuration

### 3. UserData Folder Isolation

**Risk**: Shared Electron `userData` folder
**Fix**: Override with `app.setPath('userData', ...)`

**Implementation**:

```typescript
private static setupUserDataIsolation(config: EnvironmentConfig): void {
  // Override userData path to prevent contamination
  app.setPath('userData', config.userDataPath);

  // Ensure the directory exists
  fs.mkdir(config.userDataPath, { recursive: true });
}
```

**UserData Paths**:

- Development: `~/Library/Application Support/DDALAB ConfigManager/development/`
- Testing: `~/Library/Application Support/DDALAB ConfigManager/testing/`
- Production: `~/Library/Application Support/DDALAB ConfigManager/production/`

### 4. Port Isolation

**Risk**: Shared ports (e.g., 3000)
**Fix**: Use per-mode `.env` files or dynamic ports

**Implementation**:

```typescript
const configs = {
  development: {
    ports: { web: 3000, api: 8000, traefik: 80 },
  },
  testing: {
    ports: { web: 4000, api: 9000, traefik: 1080 }, // Different ports
  },
  production: {
    ports: { web: 3000, api: 8000, traefik: 80 },
  },
};
```

**Port Assignments**:

- Development: Web=3000, API=8000, Traefik=80
- Testing: Web=4000, API=9000, Traefik=1080
- Production: Web=3000, API=8000, Traefik=80

### 5. Volume and Network Isolation

**Risk**: Shared Docker volumes and networks
**Fix**: Environment-specific prefixes

**Implementation**:

```typescript
static getVolumeName(volumeType: string): string {
  const config = this.getCurrentConfig();
  return `${config.volumes.prefix}_${volumeType}`;
}

static getNetworkName(): string {
  const config = this.getCurrentConfig();
  return config.volumes.network;
}
```

**Volume/Network Names**:

- Development: `ddalab_dev_*`, `ddalab_dev_network`
- Testing: `ddalab_test_*`, `ddalab_test_network`
- Production: `ddalab_prod_*`, `ddalab_prod_network`

### 6. Environment Detection

**Risk**: Accidental rebuild of local images
**Fix**: Pull from Docker Hub in Electron test runs

**Implementation**:

```typescript
private static detectEnvironmentMode(): 'development' | 'testing' | 'production' {
  if (process.env.NODE_ENV === 'test' || process.env.ELECTRON_IS_TESTING === 'true') {
    return 'testing';
  }

  if (process.env.NODE_ENV === 'production' || process.env.ELECTRON_IS_PRODUCTION === 'true') {
    return 'production';
  }

  return 'development';
}
```

## Environment Configuration

### Development Mode

```bash
# Start in development mode
npm run start
# or
NODE_ENV=development electron .
```

**Features**:

- Uses `.env.development`
- UserData: `~/Library/Application Support/DDALAB ConfigManager/development/`
- Docker project: `ddalab-dev-*`
- Ports: 3000, 8000, 80

### Testing Mode

```bash
# Start in testing mode
npm run start:test
# or
NODE_ENV=test ELECTRON_IS_TESTING=true electron .
```

**Features**:

- Uses `.env.testing`
- UserData: `~/Library/Application Support/DDALAB ConfigManager/testing/`
- Docker project: `ddalab-test-*`
- Ports: 4000, 9000, 1080 (different from dev)

### Production Mode

```bash
# Start in production mode
npm run start:prod
# or
NODE_ENV=production ELECTRON_IS_PRODUCTION=true electron .
```

**Features**:

- Uses `.env.production`
- UserData: `~/Library/Application Support/DDALAB ConfigManager/production/`
- Docker project: `ddalab-prod-*`
- Ports: 3000, 8000, 80

## Environment File Management

### Create Environment Files

```bash
# Generate all environment files
npm run create:env-files
```

This creates:

- `.env.development`
- `.env.testing`
- `.env.production`
- `.env.template`

### Environment File Structure

```bash
# Development
NODE_ENV=development
ELECTRON_IS_DEV=true
WEB_PORT=3000
API_PORT=8000
POSTGRES_DB=ddalab_dev
MINIO_ROOT_USER=dev_minio_user

# Testing
NODE_ENV=test
ELECTRON_IS_TESTING=true
WEB_PORT=4000
API_PORT=9000
POSTGRES_DB=ddalab_test
MINIO_ROOT_USER=test_minio_user

# Production
NODE_ENV=production
ELECTRON_IS_PRODUCTION=true
WEB_PORT=3000
API_PORT=8000
POSTGRES_DB=ddalab_prod
MINIO_ROOT_USER=prod_minio_user
```

## Docker Isolation

### Project Names

```bash
# Development
docker-compose -p ddalab-dev-projectname up

# Testing
docker-compose -p ddalab-test-projectname up

# Production
docker-compose -p ddalab-prod-projectname up
```

### Volume Names

```bash
# Development
ddalab_dev_postgres
ddalab_dev_minio
ddalab_dev_network

# Testing
ddalab_test_postgres
ddalab_test_minio
ddalab_test_network

# Production
ddalab_prod_postgres
ddalab_prod_minio
ddalab_prod_network
```

## Verification Commands

### Check Current Environment

```bash
# Check environment mode
npm run start -- --verbose

# Check Docker project names
docker ps --filter "label=com.docker.compose.project"
```

### Verify Isolation

```bash
# Check UserData paths
ls ~/Library/Application\ Support/DDALAB\ ConfigManager/

# Check Docker volumes
docker volume ls | grep ddalab

# Check Docker networks
docker network ls | grep ddalab
```

## Troubleshooting

### Common Issues

1. **Port Conflicts**

   ```bash
   # Check what's using the port
   lsof -i :3000
   lsof -i :4000

   # Kill conflicting processes
   kill -9 <PID>
   ```

2. **Docker Volume Conflicts**

   ```bash
   # List all volumes
   docker volume ls

   # Remove conflicting volumes
   docker volume rm ddalab_dev_postgres
   ```

3. **UserData Conflicts**

   ```bash
   # Check UserData directories
   ls -la ~/Library/Application\ Support/DDALAB\ ConfigManager/

   # Remove conflicting data
   rm -rf ~/Library/Application\ Support/DDALAB\ ConfigManager/testing/
   ```

### Debug Commands

```bash
# Check environment variables
echo $NODE_ENV
echo $ELECTRON_IS_TESTING

# Check Docker project
docker-compose -p ddalab-dev-projectname ps

# Check environment file
cat .env.development

# Check UserData path
ls ~/Library/Application\ Support/DDALAB\ ConfigManager/development/
```

## Best Practices

### Development

- Always use `npm run start` for development
- Use `.env.development` for configuration
- Keep development data separate

### Testing

- Use `npm run start:test` for testing
- Use `.env.testing` for configuration
- Never use production data in testing

### Production

- Use `npm run start:prod` for production
- Use `.env.production` for configuration
- Ensure proper security settings

### General

- Never share environment files between modes
- Always use environment-specific Docker projects
- Keep UserData directories separate
- Use different ports for testing
- Verify isolation before deployment

## Migration Guide

### From Old Setup

1. **Backup existing data**

   ```bash
   cp -r ~/Library/Application\ Support/DDALAB\ ConfigManager/ ~/backup/
   ```

2. **Create environment files**

   ```bash
   npm run create:env-files
   ```

3. **Update configuration**

   ```bash
   # Copy your existing .env to appropriate mode file
   cp .env .env.development
   ```

4. **Test isolation**
   ```bash
   npm run start:test
   npm run start
   ```

### Verification Checklist

- [ ] Different UserData directories
- [ ] Different Docker project names
- [ ] Different environment files
- [ ] No port conflicts
- [ ] Separate volume names
- [ ] Environment detection working

This comprehensive isolation system ensures that development, testing, and production environments remain completely separate, preventing any cross-contamination issues.
