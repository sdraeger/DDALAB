# DDALAB - Delay Differential Analysis Laboratory

DDALAB is a Python application for performing Delay Differential Analysis (DDA) on EDF files. It consists of a PyQt6-based GUI client and a FastAPI backend server with Celery for task management.

## System Requirements

- Python 3.10 or higher
- Redis server
- Virtual environment (recommended)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd python
```

2. Create and activate a virtual environment:

```bash
python -m venv .venv
source .venv/bin/activate  # On Unix/macOS
# OR
.venv\Scripts\activate  # On Windows
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Install Redis:

- **macOS** (using Homebrew):

  ```bash
  brew install redis
  ```

- **Linux**:

  ```bash
  sudo apt-get install redis-server
  ```

- **Windows**: Download from [Redis Windows Downloads](https://github.com/microsoftarchive/redis/releases)

## Configuration

The system can be configured using environment variables or a `.env` file. Available settings:

```env
# Server settings
DDALAB_HOST=localhost
DDALAB_PORT=8000

# Data directory
DDALAB_DATA_DIR=/path/to/data

# Celery settings
DDALAB_CELERY_BROKER_URL=redis://localhost:6379/0
DDALAB_CELERY_RESULT_BACKEND=redis://localhost:6379/0

# Redis settings
DDALAB_REDIS_HOST=localhost
DDALAB_REDIS_PORT=6379
DDALAB_REDIS_DB=0
```

## Running the System

1. Start Redis server:

```bash
redis-server
```

2. Start Celery worker (in a new terminal):

```bash
cd python
source .venv/bin/activate  # On Unix/macOS
# OR
.venv\Scripts\activate  # On Windows
celery -A server.celery_app worker -l info -Q analysis
```

3. Start the FastAPI server (in a new terminal):

```bash
cd python
source .venv/bin/activate  # On Unix/macOS
# OR
.venv\Scripts\activate  # On Windows
python -m server.main
```

4. Start the GUI application (in a new terminal):

```bash
cd python
source .venv/bin/activate  # On Unix/macOS
# OR
.venv\Scripts\activate  # On Windows
python main.py
```

## API Documentation

Once the server is running, you can access the API documentation at:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>

## Development

### Project Structure

```
python/
├── ddalab/              # GUI client package
│   ├── core/           # Core functionality
│   ├── gui/            # GUI components
│   └── visualization/  # Plotting utilities
├── server/              # FastAPI server package
│   ├── api/            # API endpoints
│   ├── core/           # Business logic
│   ├── schemas/        # Data models
│   └── tasks/          # Celery tasks
├── data/                # Data directory
├── requirements.txt     # Python dependencies
└── main.py             # GUI entry point
```

### Running Tests

Tests can be run using the provided scripts:

```bash
# Run all tests
./run_tests.sh

# Run tests using tox directly
tox

# Run specific tests
tox -- tests/unit/test_simple.py

# Run with specific Python version
tox -e py311
```

For more detailed information about testing, see [README_TESTS.md](README_TESTS.md).

## Troubleshooting

1. **Redis Connection Error**:

   - Ensure Redis server is running
   - Check Redis connection settings in `.env`
   - Verify Redis port is not blocked by firewall

2. **Task Processing Issues**:

   - Check Celery worker logs
   - Ensure correct queue is specified (`-Q analysis`)
   - Verify Redis has sufficient memory

3. **GUI Connection Issues**:
   - Check server URL in configuration
   - Verify server is running and accessible
   - Check for firewall restrictions

## SSL Configuration

### Using Let's Encrypt for Free SSL Certificates

To secure your server with HTTPS using free Let's Encrypt certificates, follow these steps:

1. **Install Certbot**:

   - **macOS** (using Homebrew):

     ```bash
     brew install certbot
     ```

   - **Ubuntu/Debian**:

     ```bash
     sudo apt update
     sudo apt install certbot
     ```

   - **CentOS/RHEL**:

     ```bash
     sudo dnf install certbot
     ```

2. **Obtain the certificate**:

   For a standalone Python server (like the DDALAB FastAPI server):

   ```bash
   sudo certbot certonly --standalone -d yourdomain.com
   ```

   If your server is already running, temporarily stop it and use:

   ```bash
   sudo certbot certonly --standalone --preferred-challenges http -d yourdomain.com
   ```

3. **Update your server configuration**:

   After obtaining the certificate, edit your `.env` file or update the server configuration:

   ```env
   DDALAB_SSL_ENABLED=True
   DDALAB_SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
   DDALAB_SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
   ```

4. **Set up auto-renewal**:

   Let's Encrypt certificates expire after 90 days, so set up automatic renewal:

   ```bash
   sudo crontab -e
   ```

   Add this line to run renewal check twice daily:

   ```
   0 0,12 * * * certbot renew --quiet
   ```

**Important notes**:

- You need a public domain pointing to your server's IP address
- Port 80 must be accessible for verification during certificate issuance
- The certificates will be saved in `/etc/letsencrypt/live/yourdomain.com/`
- If running on localhost/development, use mkcert instead as Let's Encrypt won't issue certificates for localhost

For a quick test without a domain, you can use:

```bash
sudo certbot certonly --standalone --test-cert -d example.com
```

This gets a test certificate that browsers won't trust, but it lets you test the process.
