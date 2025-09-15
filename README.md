# DDALAB - Delay Differential Analysis Laboratory

DDALAB is an application for performing Delay Differential Analysis (DDA) on EDF and ASCII files, consisting of a web-based GUI client and a FastAPI backend server.
The application is designed to be run on a local machine, but can be deployed to a remote server with the appropriate configuration. In the local case, the data does not leave the local machine. Additionally, the
traffic within the virtualized network is encrypted via SSL.

## Prerequisites

### Installing Docker

1. **For macOS**:
   - Download [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
   - Double-click the downloaded .dmg file and drag Docker to Applications
   - Open Docker from Applications folder

2. **For Windows**:
   - Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
   - Run the ConfigManager and follow the prompts
   - Start Docker Desktop from the Start menu

3. **For Linux (Ubuntu/Debian)**:

   ```bash
   sudo apt update
   sudo apt install docker.io docker-compose
   sudo systemctl enable --now docker
   sudo usermod -aG docker $USER
   # Log out and back in for group changes to take effect
   ```

Verify installation:

```bash
docker --version
docker-compose --version
```

## DDALAB Launcher 🚀

For the easiest way to manage DDALAB, use the **DDALAB Launcher** - a user-friendly GUI tool:

```bash
# Clone the launcher (standalone repository)
git clone https://github.com/sdraeger/DDALAB-launcher.git
cd DDALAB-launcher

# Build and run
make build
./bin/ddalab-launcher
```

The launcher provides:
- 🔍 **Auto-detection** of DDALAB installations
- 🎯 **Interactive menu** for all operations
- ⚡ **Interrupt support** (Ctrl+C) for long operations
- 🖥️ **Cross-platform** support (Linux, macOS, Windows)
- 📊 **Status monitoring** and log viewing

## DDALAB Docker Extension 🐳

For Docker Desktop users, there's also a **Docker Extension** available:

```bash
# Clone the extension (standalone repository)
git clone https://github.com/sdraeger/DDALAB-docker-ext.git
cd DDALAB-docker-ext

# Build and install the extension
make build-extension
docker extension install ddalab/desktop-extension:latest
```

The extension provides Docker Desktop integration with multiple UI variants.

## Quick Start (Docker) 🚀

For manual setup, the traditional way to run DDALAB:

```bash
# 1. Clone the repository
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB

# 2. Copy environment template
cp .env.production.example .env

# 3. Edit .env - CHANGE ALL PASSWORDS!
nano .env  # or your preferred editor

# 4. Start everything
docker-compose up -d

# 5. Access DDALAB
# Open https://localhost in your browser
# (Accept the self-signed certificate warning)
```

That's it! DDALAB is now running at:
- **Web Interface**: https://localhost (accept the SSL warning)
- **API Documentation**: http://localhost:8001/docs (API server direct access)
- **MinIO Console**: http://localhost:9001 (optional admin interface)

To stop: `docker-compose down`

## Alternative Deployment Methods

### Option 1: Using ConfigManager (Desktop App)

DDALAB includes a desktop application that can manage deployments:

```bash
# Build and run ConfigManager
cd packages/configmanager
npm install
npm run dev
```

### Option 2: Development Mode

For local development with hot-reload:

```bash
# Start only infrastructure services
docker-compose -f docker-compose.dev.yml up -d

# Run API and Web locally
npm run dev:local:concurrent

# Access the application
# Web interface: https://localhost
# API documentation: https://localhost/api/docs
```

### Option 2: Manual Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/sdraeger/DDALAB.git
   cd DDALAB
   ```

2. **Configure environment variables**:
   - Copy the example .env files (root and ddalab-web):

     ```bash
     cp .env.example .env
     ```

     ```bash
     cp ddalab-web/.env.example ddalab-web/.env.local
     ```

   - Edit the .env files with your preferred settings:

     ```bash
     vim .env
     ```

     ```bash
     vim ddalab-web/.env.local
     ```

3. **Start the application**:

   ```bash
   docker-compose up --build
   ```

   Add `-d` flag to run in detached mode:

   ```bash
   docker-compose up --build -d
   ```

4. **Access the application**:
   - Web interface: `https://localhost`
   - API documentation: `https://localhost/docs`

5. **Stop the application**:

   ```bash
   docker-compose down
   ```

## Docker Hub Setup

If you want to contribute to the project and have your changes automatically build and push Docker images to Docker Hub, see [DOCKER_HUB_SETUP.md](DOCKER_HUB_SETUP.md) for detailed instructions on setting up the required credentials.

### Push Images to Docker Hub

```bash
# Build images first
npm run build:docker

# Push to Docker Hub
npm run push:docker

# On Windows
npm run push:docker:win
```

For detailed instructions, see [DOCKER_PUSH_GUIDE.md](DOCKER_PUSH_GUIDE.md).

## Development

### Getting Submodules (for developers)

The DDALAB Launcher and Docker Extension are included as git submodules. To get them when cloning:

```bash
# Clone with submodules
git clone --recursive https://github.com/sdraeger/DDALAB.git

# Or if already cloned, initialize submodules
git submodule update --init --recursive
```

The submodules will be available in:
- `launcher/` - DDALAB Launcher (CLI tool)
- `docker-extension/` - Docker Desktop Extension

### ConfigManager Development

To run the ConfigManager application in development mode:

```bash
# Start ConfigManager in development mode with hot reloading
npm run dev:configmanager

# Or use the shell script
./scripts/dev-configmanager.sh

# For Windows users
scripts\dev-configmanager.bat
```

For detailed development instructions, see [packages/configmanager/DEV_README.md](packages/configmanager/DEV_README.md).

## SSL Configuration

If using `traefik` for SSL:

1. Create `server.crt` and `server.key` in the `certs/` directory

   ```bash
   openssl genrsa -out server.key 2048
   openssl req -new -key server.key -out server.csr
   openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
   ```

2. Generate a username and password hash for the traefik dashboard

   ```bash
   echo -n "admin" | htpasswd -c auth admin
   ```

3. Set the hash in your configuration:

   **New configuration system:**
   ```bash
   # Generate production deployment with secure defaults
   npm run deploy:prod
   cd deployments/production-docker-compose
   # Edit .env to set TRAEFIK_PASSWORD_HASH
   ```

   **Legacy approach:**
   ```
   TRAEFIK_PASSWORD_HASH='$2y$...'  # Make sure to use single quotes
   ```

## Troubleshooting

1. **Container startup issues**:
   - Check logs: `docker-compose logs`
   - Specific service logs: `docker-compose logs server`

2. **Connection issues**:
   - Ensure ports aren't blocked by firewall
   - Verify ports aren't being used by other services

3. **Performance issues**:
   - Check Docker resource allocation in Docker Desktop settings
   - Increase memory/CPU limits if needed

## Project Structure

```
├── docker-compose.yml    # Docker configuration
├── .env                  # Environment configuration
├── python/               # Application code
│   ├── ddalab/           # GUI client package
│   ├── server/           # FastAPI server package
│   └── ...
└── data/                 # Default data directory
```

## API Documentation

Once running, access the API documentation at:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`
