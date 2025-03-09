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

# Create SSL directory and configuration
RUN mkdir -p /app/ssl && \
	echo "[ req ]\n\
	default_bits = 4096\n\
	prompt = no\n\
	default_md = sha256\n\
	req_extensions = req_ext\n\
	distinguished_name = dn\n\
	[ dn ]\n\
	C = US\n\
	ST = State\n\
	L = City\n\
	O = Organization\n\
	CN = localhost\n\
	[ req_ext ]\n\
	subjectAltName = @alt_names\n\
	[ alt_names ]\n\
	DNS.1 = localhost\n\
	IP.1 = 127.0.0.1\n\
	IP.2 = ::1" > /app/ssl/openssl.conf

# Generate self-signed certificate with proper SAN
RUN openssl req -x509 -nodes \
	-keyout /app/ssl/key.pem \
	-out /app/ssl/cert.pem \
	-days 365 \
	-config /app/ssl/openssl.conf

# Generate a secure JWT secret key
RUN openssl rand -hex 32 > /app/jwt_secret.key && \
	chmod 600 /app/jwt_secret.key

# Set the JWT secret key environment variable in the startup script
RUN echo 'export DDALAB_JWT_SECRET_KEY=$(cat /app/jwt_secret.key)' >> /app/env.sh && \
	chmod +x /app/env.sh

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
	source /app/env.sh\n\
	redis-server --daemonize yes\n\
	celery -A server.celery_app worker --loglevel=info &\n\
	uvicorn server.main:app --host 0.0.0.0 --port 8001\n\
	' > /app/start.sh && chmod +x /app/start.sh

# Command to run the services
CMD ["/app/start.sh"]
