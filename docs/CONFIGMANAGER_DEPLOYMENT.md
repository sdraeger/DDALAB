# ConfigManager Deployment Integration

This document describes how the ConfigManager orchestrates DDALAB deployment, configuration management, and updates.

## Overview

The ConfigManager is an Electron application distributed via AWS S3 that serves as the central orchestration tool for DDALAB. It manages:

1. **Configuration Persistence**: Stores deployment configuration on disk with versioning
2. **Docker Deployment**: Manages Docker containers without host filesystem dependencies
3. **Automatic Updates**: Handles updates with rollback capability
4. **State Management**: Maintains deployment state across application restarts

## Architecture

### Services

1. **DeploymentConfigService**
   - Manages deployment configuration with YAML persistence
   - Handles configuration versioning and migrations
   - Generates Docker environment variables
   - Creates configuration backups

2. **DockerDeploymentService**
   - Generates docker-compose.yml from configuration
   - Manages container lifecycle (start, stop, restart)
   - Monitors service health
   - Streams logs and executes commands

3. **DeploymentUpdateService**
   - Checks for DDALAB updates
   - Downloads new Docker images
   - Performs updates with automatic rollback on failure
   - Maintains rollback history

### Configuration Flow

```
ConfigManager (Electron App)
    |
    ├── DeploymentConfigService
    |   ├── deployment-config.yml (persisted)
    |   └── config-backups/
    |
    ├── DockerDeploymentService
    |   ├── Generates docker-compose.yml
    |   ├── Generates .env file
    |   └── Manages containers
    |
    └── DeploymentUpdateService
        ├── Checks update server
        ├── Downloads new images
        └── Performs rolling updates
```

## Configuration Management

### Configuration Storage

Configuration is stored in:
- **Primary**: `~/.config/configmanager/deployment-config.yml`
- **Backups**: `~/.config/configmanager/config-backups/`

### Configuration Schema

```yaml
version: 2.0.0
environment: production

api:
  host: 0.0.0.0
  port: 8001
  publicUrl: https://api.example.com

database:
  host: postgres
  port: 5432
  name: ddalab
  user: ddalab_user
  password: secure_password

storage:
  minio:
    host: minio
    port: 9000
    accessKey: access_key
    secretKey: secret_key
  dataDir: /app/data

docker:
  image: ddalab:latest
  composeFile: docker-compose.prod.yml
  networks: [ddalab-network]
  volumes:
    ddalab-data: /app/data
```

### Configuration Versioning

The system automatically migrates configurations between versions:

```typescript
// Example migration
{
  version: '2.0.0',
  description: 'Add Docker deployment configuration',
  up: (config) => ({
    ...config,
    docker: {
      image: 'ddalab:latest',
      // ... default values
    }
  }),
  down: (config) => {
    const { docker, ...rest } = config;
    return rest;
  }
}
```

## Deployment Process

### Initial Deployment

1. **User launches ConfigManager**
2. **Configuration wizard** guides through setup
3. **ConfigManager generates**:
   - deployment-config.yml
   - docker-compose.yml
   - .env file with all settings
4. **Docker deployment**:
   - Pulls images
   - Starts containers
   - Monitors health

### Configuration Updates

1. **User modifies settings** in ConfigManager UI
2. **Validation** ensures configuration is valid
3. **Backup created** automatically
4. **Services restarted** with new configuration
5. **Health check** verifies successful update

## Update Management

### Update Process

1. **Check for updates** (manual or automatic)
2. **Download new images** with progress tracking
3. **Create rollback point**:
   - Tag current image
   - Backup configuration
4. **Deploy update**:
   - Stop containers
   - Update configuration
   - Start new containers
5. **Verify health**
6. **Automatic rollback** on failure

### Rollback Capability

The system maintains up to 3 rollback points:

```typescript
interface RollbackInfo {
  version: string;
  timestamp: Date;
  backupPath: string;
  configBackupPath: string;
}
```

## API Integration

### IPC Communication

The renderer process communicates with main process via IPC:

```typescript
// Renderer
const result = await window.electronAPI.deployment.config.get();
if (result.success) {
  console.log('Config:', result.config);
}

// Main process
ipcMain.handle('deployment:config:get', async () => {
  const config = configService.getConfig();
  return { success: true, config };
});
```

### Available IPC Channels

#### Configuration
- `deployment:config:get` - Get current configuration
- `deployment:config:update` - Update configuration
- `deployment:config:backup` - Create backup
- `deployment:config:restore` - Restore from backup
- `deployment:config:validate` - Validate configuration

#### Docker
- `docker:deploy:start` - Start deployment
- `docker:deploy:stop` - Stop deployment
- `docker:deploy:getStatus` - Get status
- `docker:deploy:getLogs` - Get logs
- `docker:deploy:exec` - Execute command

#### Updates
- `deployment:update:check` - Check for updates
- `deployment:update:download` - Download update
- `deployment:update:install` - Install update
- `deployment:update:rollback` - Rollback to previous

## Security Considerations

1. **Credentials**: Stored encrypted in deployment-config.yml
2. **Updates**: Verified with checksums
3. **Rollback**: Automatic on failed updates
4. **Isolation**: Each deployment runs in isolated Docker network
5. **Permissions**: ConfigManager runs with user privileges only

## Development Workflow

### Adding New Configuration Options

1. Update `DeploymentConfig` interface
2. Add to `DEFAULT_CONFIG`
3. Create migration if needed
4. Update UI components

### Testing Deployment

```bash
# Run ConfigManager in development
npm run dev:configmanager

# Test deployment locally
# ConfigManager will use local Docker daemon
```

### Building ConfigManager

```bash
# Build for distribution
npm run build:configmanager
npm run package:prod:all

# Upload to S3
npm run publish:prod:all
```

## Troubleshooting

### Common Issues

1. **"Docker not found"**
   - Ensure Docker Desktop is installed and running
   - ConfigManager will show installation instructions

2. **"Configuration invalid"**
   - Check validation errors in UI
   - Ensure required fields are filled

3. **"Update failed"**
   - Check logs in ConfigManager
   - Use rollback feature to restore previous version

### Logs

ConfigManager logs are stored in:
- macOS: `~/Library/Logs/ConfigManager/`
- Windows: `%APPDATA%\ConfigManager\logs\`
- Linux: `~/.config/ConfigManager/logs/`

### Reset Configuration

To completely reset:
1. Stop all services via ConfigManager
2. Delete `~/.config/configmanager/`
3. Restart ConfigManager

## Benefits

1. **No Host Dependencies**: Configuration stored in ConfigManager, not on host
2. **Easy Updates**: One-click updates with automatic rollback
3. **Version Control**: Configuration history and backups
4. **User Friendly**: GUI for all operations
5. **Cross-Platform**: Works on macOS, Windows, Linux

## Future Enhancements

1. **Cloud Backup**: Sync configuration to cloud storage
2. **Multi-Instance**: Manage multiple DDALAB deployments
3. **Monitoring Dashboard**: Real-time metrics and alerts
4. **Plugin System**: Extend with custom functionality
5. **Kubernetes Support**: Deploy to K8s clusters
