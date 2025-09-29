# DDALAB Management API Contract v1

## Core Lifecycle Operations

### Status Management
```
GET  /api/v1/status              → Get current DDALAB status
GET  /api/v1/status/health       → Detailed health check
GET  /api/v1/status/services     → Individual service status
```

### Lifecycle Operations  
```
POST /api/v1/lifecycle/start     → Start DDALAB stack
POST /api/v1/lifecycle/stop      → Stop DDALAB stack  
POST /api/v1/lifecycle/restart   → Restart DDALAB stack
POST /api/v1/lifecycle/update    → Update DDALAB to latest
```

### Configuration Management
```
GET  /api/v1/config              → Get current configuration
PUT  /api/v1/config              → Update configuration
GET  /api/v1/config/env          → Get environment variables
PUT  /api/v1/config/env          → Update environment variables
POST /api/v1/config/validate     → Validate configuration
```

### Installation Management
```
GET  /api/v1/installation        → Get installation info
POST /api/v1/installation/detect → Auto-detect installation
POST /api/v1/installation/setup  → Setup new installation
POST /api/v1/installation/validate → Validate installation
```

### Backup & Maintenance
```
POST /api/v1/backup              → Create backup
GET  /api/v1/backup              → List backups
POST /api/v1/backup/{id}/restore → Restore backup
GET  /api/v1/logs                → Get system logs
POST /api/v1/maintenance/cleanup → Cleanup resources
```

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "metadata": {
    "timestamp": "2025-01-01T00:00:00Z",
    "api_version": "v1",
    "server_version": "1.0.0"
  }
}
```

### Error Response  
```json
{
  "success": false,
  "error": {
    "code": "DDALAB_NOT_FOUND",
    "message": "DDALAB installation not found",
    "details": "No docker-compose.yml found in specified path"
  },
  "metadata": {
    "timestamp": "2025-01-01T00:00:00Z", 
    "api_version": "v1"
  }
}
```

## Data Models

### Status Model
```json
{
  "running": true,
  "state": "up|down|starting|stopping|error",
  "services": [
    {
      "name": "ddalab",
      "status": "running",
      "health": "healthy|unhealthy|starting", 
      "uptime": "2h30m"
    }
  ],
  "installation": {
    "path": "/Users/simon/Desktop/DDALAB-setup",
    "version": "latest",
    "last_updated": "2025-01-01T00:00:00Z"
  }
}
```

### Configuration Model
```json
{
  "installation_path": "/path/to/ddalab-setup",
  "environment": {
    "DDALAB_URL": "https://localhost",
    "POSTGRES_PASSWORD": "***",
    "REDIS_HOST": "redis"
  },
  "features": {
    "ssl_enabled": true,
    "monitoring_enabled": true
  }
}
```