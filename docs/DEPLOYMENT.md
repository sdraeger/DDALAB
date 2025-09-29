# DDALAB Production Deployment Guide

This guide explains how to deploy DDALAB in production without relying on host filesystem configuration files. All configuration is done through environment variables, making deployments portable and updateable.

## Quick Start

1. **Clone the repository** (only needed for docker-compose files):
   ```bash
   git clone https://github.com/yourusername/ddalab.git
   cd ddalab
   ```

2. **Create environment file**:
   ```bash
   cp .env.production.example .env
   # Edit .env and update all CHANGE_ME values
   ```

3. **Deploy**:
   ```bash
   ./deploy/deploy.sh deploy
   ```

## Architecture

The deployment consists of:
- **DDALAB**: Main application container (API + Web interface)
- **PostgreSQL**: Database
- **Redis**: Caching and session storage
- **MinIO**: S3-compatible object storage
- **Traefik** (optional): Reverse proxy with SSL

## Configuration

### No Host Config Files Required

The DDALAB Docker image includes a baked-in default configuration. You only need to provide environment variables for:

1. **Service endpoints** (database, redis, minio hosts)
2. **Credentials** (passwords, JWT secrets)
3. **Public URLs** (for your domain)

### Environment Variables

Create a `.env` file with these required variables:

```bash
# Database
POSTGRES_USER=ddalab_prod
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=ddalab_production

# MinIO
MINIO_ROOT_USER=ddalab_minio
MINIO_ROOT_PASSWORD=<strong-password>

# Security
DDALAB_JWT_SECRET=<random-32+-char-string>

# Public URLs
DDALAB_PUBLIC_API_URL=https://api.yourdomain.com
DDALAB_PUBLIC_APP_URL=https://app.yourdomain.com
```

### Configuration Precedence

1. **Environment variables** (highest priority)
2. **Mounted config file** at `/config/config.yml` (optional)
3. **Baked-in defaults** (always available)

## Deployment Steps

### Initial Deployment

1. **Prepare environment**:
   ```bash
   # Install Docker and Docker Compose
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   
   # Install Docker Compose
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
     -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

2. **Configure environment**:
   ```bash
   cp .env.production.example .env
   nano .env  # Update all values
   ```

3. **Deploy services**:
   ```bash
   ./deploy/deploy.sh deploy
   ```

4. **Check status**:
   ```bash
   ./deploy/monitor.sh
   ```

### Updating

To update to the latest version:

```bash
./deploy/deploy.sh update
```

Or set up automatic updates:

```bash
# Add to crontab for daily updates at 2 AM
crontab -e
0 2 * * * /path/to/ddalab/deploy/auto-update.sh
```

### SSL/HTTPS Setup

#### Option 1: Using Traefik (Recommended)

1. Update `.env`:
   ```bash
   DDALAB_DOMAIN=yourdomain.com
   ACME_EMAIL=admin@yourdomain.com
   ```

2. Enable Traefik labels in `docker-compose.prod.yml` (uncomment the labels section)

3. Deploy:
   ```bash
   ./deploy/deploy.sh deploy
   ```

#### Option 2: External Reverse Proxy

Configure your reverse proxy (nginx, Apache, etc.) to:
- Forward `yourdomain.com` → `localhost:3000`
- Forward `yourdomain.com/api/*` → `localhost:8001/*`

## Monitoring

### Health Checks

All services include health checks. Monitor with:

```bash
# One-time check
./deploy/monitor.sh

# Continuous monitoring
./deploy/monitor.sh continuous
```

### Logs

View logs:

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f ddalab
```

### Metrics

The application exports metrics to:
- Prometheus endpoint: `http://localhost:8001/metrics`
- OpenTelemetry: Configure `DDA_OTLP_HOST` and `DDA_OTLP_PORT`

## Backup and Recovery

### Automated Backups

```bash
# Manual backup
./deploy/deploy.sh backup

# Automated daily backups (add to crontab)
0 3 * * * /path/to/ddalab/deploy/deploy.sh backup
```

### Recovery

1. Stop services:
   ```bash
   ./deploy/deploy.sh stop
   ```

2. Restore volumes:
   ```bash
   # Restore PostgreSQL
   docker-compose -f docker-compose.prod.yml up -d postgres
   docker-compose -f docker-compose.prod.yml exec -T postgres psql -U ddalab < backups/*/postgres_backup.sql
   
   # Restore other volumes
   for volume in postgres-data redis-data minio-data ddalab-data; do
     docker run --rm -v ${volume}:/data -v ./backups/*/:/backup alpine \
       tar -xzf /backup/${volume}.tar.gz -C /data
   done
   ```

3. Start services:
   ```bash
   ./deploy/deploy.sh deploy
   ```

## Troubleshooting

### Services Won't Start

1. Check logs:
   ```bash
   docker-compose -f docker-compose.prod.yml logs
   ```

2. Verify environment:
   ```bash
   # Check if all required variables are set
   ./deploy/deploy.sh deploy
   ```

3. Check disk space:
   ```bash
   df -h
   docker system df
   ```

### Connection Issues

1. Verify services are running:
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

2. Test endpoints:
   ```bash
   curl http://localhost:8001/health
   curl http://localhost:3000
   ```

3. Check firewall:
   ```bash
   sudo ufw status
   # Allow ports if needed
   sudo ufw allow 8001/tcp
   sudo ufw allow 3000/tcp
   ```

### Performance Issues

1. Check resource usage:
   ```bash
   ./deploy/monitor.sh resources
   ```

2. Scale services:
   ```bash
   # Increase container resources in docker-compose.prod.yml
   # Add under service definition:
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 4G
   ```

## Security Best Practices

1. **Change all default passwords** in `.env`
2. **Use strong JWT secret** (32+ random characters)
3. **Enable firewall** and only open required ports
4. **Use HTTPS** in production (via Traefik or reverse proxy)
5. **Regular updates**: Enable auto-updates or update manually
6. **Backup regularly**: Set up automated backups
7. **Monitor logs**: Check for suspicious activity

## Advanced Configuration

### Custom Configuration File

If you need to override more settings, mount a custom config:

```yaml
# docker-compose.override.yml
services:
  ddalab:
    volumes:
      - ./custom-config.yml:/config/config.yml:ro
```

### Environment-Specific Settings

Use different `.env` files:

```bash
# Staging
cp .env.staging .env
./deploy/deploy.sh deploy

# Production
cp .env.production .env
./deploy/deploy.sh deploy
```

### Multi-Node Deployment

For high availability, use Docker Swarm or Kubernetes. The stateless design of DDALAB supports horizontal scaling.

## Support

- Documentation: `/docs` directory
- Issues: GitHub Issues
- Logs: Check container logs first
- Health endpoint: `http://your-domain/api/health`