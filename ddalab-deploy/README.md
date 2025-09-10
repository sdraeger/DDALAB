# DDALAB Docker Deployment

Deploy DDALAB with a single command using Docker.

## 🚀 Quick Start

### Prerequisites
- Docker 20.10+ and Docker Compose 2.0+
- 8GB RAM, 20GB disk space

### Linux/macOS

```bash
# Clone and start DDALAB
git clone https://github.com/yourusername/ddalab-deploy.git
cd ddalab-deploy
./ddalab.sh start
```

### Windows

```powershell
# Clone and start DDALAB
git clone https://github.com/yourusername/ddalab-deploy.git
cd ddalab-deploy
.\ddalab.ps1 start
```

That's it! The script will:
- ✅ Check requirements
- ✅ Generate secure passwords automatically
- ✅ Create SSL certificates
- ✅ Start all services
- ✅ Display access information

Access DDALAB at: **https://localhost**

Default credentials:
- Email: **admin@example.com**  
- Password: **admin** (change immediately!)

## 📝 Commands

### Linux/macOS
```bash
./ddalab.sh start    # Start DDALAB
./ddalab.sh stop     # Stop DDALAB
./ddalab.sh restart  # Restart DDALAB
./ddalab.sh logs     # View logs
./ddalab.sh status   # Check status
./ddalab.sh backup   # Backup database
```

### Windows
```powershell
.\ddalab.ps1 start    # Start DDALAB
.\ddalab.ps1 stop     # Stop DDALAB
.\ddalab.ps1 restart  # Restart DDALAB
.\ddalab.ps1 logs     # View logs
.\ddalab.ps1 status   # Check status
.\ddalab.ps1 backup   # Backup database
```

## 🔧 Configuration

### Environment Variables

All configuration is done through the `.env` file. Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `DOMAIN` | Your domain name | localhost |
| `PUBLIC_URL` | Full URL including protocol | https://localhost |
| `DB_PASSWORD` | PostgreSQL password | MUST CHANGE |
| `MINIO_ROOT_PASSWORD` | MinIO admin password | MUST CHANGE |
| `JWT_SECRET_KEY` | JWT signing key | MUST CHANGE |
| `NEXTAUTH_SECRET` | NextAuth secret | MUST CHANGE |

### Authentication Modes

DDALAB supports three authentication modes:

1. **Local Authentication** (default)
   ```env
   DDALAB_AUTH_MODE=local
   ```

2. **LDAP Authentication**
   ```env
   DDALAB_AUTH_MODE=ldap
   LDAP_SERVER_URL=ldap://your-server:389
   LDAP_BIND_DN=cn=admin,dc=example,dc=com
   LDAP_BIND_PASSWORD=your-password
   ```

3. **OAuth Authentication**
   ```env
   DDALAB_AUTH_MODE=oauth
   OAUTH_CLIENT_ID=your-client-id
   OAUTH_CLIENT_SECRET=your-secret
   OAUTH_ISSUER=https://your-provider.com
   ```

### Data Storage

All persistent data is stored in Docker volumes:
- `postgres-data`: Database files
- `minio-data`: Uploaded EDF/ASCII files
- `redis-data`: Cache and session data

User data files are mounted from `./data` directory.

## 🔒 Security Considerations

1. **Change ALL default passwords** in `.env`
2. **Generate strong secrets** using:
   ```bash
   openssl rand -base64 32
   ```
3. **Use proper SSL certificates** for production
4. **Restrict network access** using firewall rules
5. **Enable automatic backups** (see below)

## 🗄️ Backup and Restore

### Enable Automatic Backups

```bash
# Start with backup profile
docker-compose --profile backup up -d
```

Backups are stored in `./backups` directory.

### Manual Backup

```bash
./scripts/backup.sh
```

### Restore from Backup

```bash
./scripts/restore.sh backup-file.sql.gz
```

## 🔍 Monitoring and Logs

### View Service Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f ddalab
```

### Health Checks

```bash
# Check service status
docker-compose ps

# Test database connection
docker-compose exec postgres pg_isready

# Check MinIO status
curl -f http://localhost:9001/minio/health/live
```

## 🛠️ Maintenance

### Update DDALAB

```bash
# Pull latest image
docker-compose pull ddalab

# Restart service
docker-compose up -d ddalab
```

### Database Maintenance

```bash
# Access PostgreSQL shell
docker-compose exec postgres psql -U ddalab

# Vacuum database
docker-compose exec postgres vacuumdb -U ddalab -d ddalab
```

### Clear Cache

```bash
# Flush Redis cache
docker-compose exec redis redis-cli FLUSHALL
```

## 🐛 Troubleshooting

### Service won't start

1. Check logs: `docker-compose logs [service-name]`
2. Verify environment variables in `.env`
3. Ensure ports are not in use: `netstat -tulpn | grep -E '80|443|5432|6379|9000'`

### Cannot access web interface

1. Check if services are running: `docker-compose ps`
2. Verify SSL certificates exist in `./certs`
3. Check Traefik logs: `docker-compose logs traefik`

### Database connection errors

1. Verify PostgreSQL is healthy: `docker-compose ps postgres`
2. Check credentials in `.env`
3. Ensure database initialization completed

### File upload issues

1. Check MinIO is running: `docker-compose ps minio`
2. Verify MinIO credentials
3. Check available disk space

## 📦 Advanced Configuration

### Using External Database

```env
# In .env, point to external database
DB_HOST=your-external-db.com
DB_PORT=5432
```

Then remove the postgres service from docker-compose.yml.

### Custom SSL Certificates

Place your certificates in `./certs`:
- `cert.pem`: Certificate file
- `key.pem`: Private key file

### Resource Limits

Uncomment and adjust in `.env`:
```env
POSTGRES_MEMORY_LIMIT=2g
REDIS_MEMORY_LIMIT=512m
MINIO_MEMORY_LIMIT=1g
DDALAB_MEMORY_LIMIT=4g
```

## 🤝 Support

- GitHub Issues: [github.com/yourusername/ddalab-deploy/issues](https://github.com/yourusername/ddalab-deploy/issues)
- Documentation: [ddalab.docs.com](https://ddalab.docs.com)
- Email: support@ddalab.com

## 📝 License

This deployment configuration is provided under the MIT License.