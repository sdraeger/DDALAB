# Use Python 3.11 slim image as base
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
	PYTHONUNBUFFERED=1 \
	PYTHONPATH=/app \
	DDALAB_REDIS_HOST=redis \
	DDALAB_CELERY_BROKER_URL=redis://redis:6379/0 \
	DDALAB_CELERY_RESULT_BACKEND=redis://redis:6379/0 \
	DDALAB_SSL_ENABLED=true \
	DDALAB_SSL_CERT_PATH=/app/ssl/cert.pem \
	DDALAB_SSL_KEY_PATH=/app/ssl/key.pem

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
	build-essential \
	redis-server \
	openssl \
	&& rm -rf /var/lib/apt/lists/*

# Create SSL directory and generate self-signed certificates
RUN mkdir -p /app/ssl && \
	openssl req -x509 -newkey rsa:4096 -nodes \
	-keyout /app/ssl/key.pem \
	-out /app/ssl/cert.pem \
	-days 365 \
	-subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the server code
COPY server/ server/
COPY ddalab/ ddalab/
COPY .env .

# Expose the ports
EXPOSE 8001 6379

# Create startup script
RUN echo '#!/bin/bash\n\
	redis-server --daemonize yes\n\
	celery -A server.celery_app worker --loglevel=info &\n\
	uvicorn server.main:app --host 0.0.0.0 --port 8001\n\
	' > /app/start.sh && chmod +x /app/start.sh

# Command to run the services
CMD ["/app/start.sh"]
