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
