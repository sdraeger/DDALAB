# DDALAB Deployment Package

This folder contains everything needed to deploy DDALAB using Docker.

## ✅ What's Included

- **Single-command deployment scripts**
  - `ddalab.sh` - Linux/macOS
  - `ddalab.ps1` - Windows PowerShell  
  - `ddalab.bat` - Windows batch wrapper

- **Docker configuration**
  - `docker-compose.yml` - Complete service stack
  - `.env.example` - Environment template

- **Support scripts** (all self-contained)
  - `scripts/generate-certs.sh` - SSL certificate generation
  - `scripts/backup.sh` - Database backup
  - `scripts/restore.sh` - Database restore
  - `scripts/init-db.sh` - Database initialization
  - `scripts/traefik-config.yml` - SSL configuration

- **Documentation**
  - `README.md` - Full documentation
  - `QUICK_START.md` - Quick reference

## 🚀 Deploy DDALAB

1. **Copy this folder** to your server
2. **Run the start command**:
   - Linux/macOS: `./ddalab.sh start`
   - Windows: `.\ddalab.ps1 start` or `ddalab.bat start`
3. **Access** at https://localhost

That's it! No additional downloads or dependencies needed (except Docker).

## 📦 Package Info

- All scripts are self-contained
- No external dependencies
- Automatic password generation
- SSL certificates included
- Works offline (after Docker images are pulled)

## 🔄 Updates

To update DDALAB to the latest version:
```bash
./ddalab.sh stop
docker pull sdraeger1/ddalab:latest  
./ddalab.sh start
```