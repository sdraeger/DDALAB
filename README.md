# DDALAB - Delay Differential Analysis Laboratory

DDALAB is an application for performing Delay Differential Analysis (DDA) on EDF and ASCII files, consisting of a web-based GUI client and a FastAPI backend server with Celery for task management.
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

## Getting Started

### Option 1: Quick Docker Deployment (Recommended)

For the easiest setup, use our automated deployment script:

```bash
# Clone the repository
git clone https://github.com/sdraeger/DDALAB.git
cd DDALAB

# Run the deployment script
./deploy-ddalab.sh

# Access the application
# Web interface: http://localhost:3000
# API documentation: http://localhost:8001/docs
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

3. Set the hash in your `.env` file:

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
