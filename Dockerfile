# Use a multi-stage build for efficiency
# Stage 1: Build the API
FROM python:3.10-alpine AS api-builder

WORKDIR /app/api

# Install API dependencies
COPY packages/api/requirements.txt .
RUN apk update && apk add --no-cache \
	build-base \
	gcc \
	openssl \
	openssl-dev \
	libpq-dev \
	curl \
	netcat-openbsd \
	wget \
	bash \
	&& rm -rf /var/cache/apk/*
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy API source code
COPY packages/api .

# Stage 2: Build the Web20 app
FROM node:20-alpine AS web-builder

WORKDIR /app/web20

# Install build tools
RUN apk update && apk add --no-cache \
    build-base \
    gcc \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Accept API URL at build time (can be overridden)
ARG NEXT_PUBLIC_API_URL=http://localhost:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy and install dependencies
COPY packages/web20/package*.json ./
RUN npm ci || npm install

# Copy source
COPY packages/web20 .

# Build Next.js app (standalone output for lean runtime)
RUN npm run build

# Stage 3: Final Monolithic Image
FROM python:3.10-alpine

WORKDIR /app

# Copy API build artifacts
COPY --from=api-builder /app/api /app/api

# Install Node.js runtime to serve Next.js
RUN apk update && apk add --no-cache nodejs-current npm && rm -rf /var/cache/apk/*

# Copy web20 build artifacts
COPY --from=web-builder /app/web20 /app/web20

# Install DDA binary (if needed)
RUN mkdir -p /app/bin
RUN wget https://snl.salk.edu/~sfdraeger/dda/downloads/run_DDA_EPILEPSY -O /app/bin/run_DDA_ASCII
RUN chmod +x /app/bin/run_DDA_ASCII

# Create non-root user
RUN adduser -D -s /bin/sh ddalabuser \
    && chown -R ddalabuser:ddalabuser /app \
    && mkdir -p /tmp/prometheus \
    && chown -R ddalabuser:ddalabuser /tmp/prometheus \
    && chmod 755 /tmp/prometheus \
    && mkdir -p /app/data \
    && chown -R ddalabuser:ddalabuser /app/data \
    && mkdir -p /app/api/.config \
    && chown -R ddalabuser:ddalabuser /app/api/.config
# Expose ports
EXPOSE 8001
EXPOSE 3000

# Create a start script
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Default workdir for API (start script will cd as needed)
WORKDIR /app

CMD ["/usr/local/bin/start.sh"]
