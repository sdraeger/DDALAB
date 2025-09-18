# Stage 1: Build the API dependencies
FROM python:3.10-slim AS api-builder

WORKDIR /app/api

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    libpq-dev \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python requirements
COPY packages/api/requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: Build the shared package
FROM node:20-alpine AS shared-builder

WORKDIR /app/shared

# Copy and install shared package dependencies first (better caching)
COPY packages/shared/package*.json ./
RUN npm ci || npm install --force
COPY packages/shared .
RUN npm run build 2>/dev/null || true

# Stage 3: Build the Web20 app
FROM node:20-alpine AS web20-builder

WORKDIR /app

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

# Setup monorepo structure
RUN mkdir -p /app/packages

# Copy shared package first
COPY --from=shared-builder /app/shared /app/packages/shared

# Copy and install dependencies
COPY packages/web20/package*.json /app/packages/web20/
WORKDIR /app/packages/web20
RUN npm ci || npm install --force

# Copy source (maintaining relative paths)
COPY packages/web20 /app/packages/web20/
WORKDIR /app/packages/web20

# Build Next.js app (standalone output for lean runtime)
RUN npm run build && rm -rf node_modules

# Stage 4: Build the Web30 app
FROM node:20-alpine AS web30-builder

WORKDIR /app

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

# Setup monorepo structure
RUN mkdir -p /app/packages

# Copy shared package first
COPY --from=shared-builder /app/shared /app/packages/shared

# Copy and install dependencies
COPY packages/web30/package*.json /app/packages/web30/
WORKDIR /app/packages/web30
RUN npm ci || npm install --force

# Copy source (maintaining relative paths)
COPY packages/web30 /app/packages/web30/
WORKDIR /app/packages/web30

# Build Next.js app (standalone output for lean runtime)
RUN npm run build:docker && rm -rf node_modules

# Stage 5: Final runtime image
FROM python:3.10-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    nodejs \
    npm \
    libpq5 \
    curl \
    bash \
    wget \
    netcat-openbsd \
    # Libraries for DDA binary
    libc6 \
    libstdc++6 \
    libgcc-s1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder (using pip install location)
COPY --from=api-builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=api-builder /usr/local/bin /usr/local/bin

# Copy API source code
COPY packages/api /app/api
RUN chmod +x /app/api/start.sh

# Copy Docker Swarm entrypoint script
COPY packages/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy standalone builds with proper structure
COPY --from=web20-builder /app/packages/web20/.next/standalone/packages/web20/ /app/web20/
COPY --from=web20-builder /app/packages/web20/.next/static /app/web20/.next/static

COPY --from=web30-builder /app/packages/web30/.next/standalone/packages/web30/ /app/web30/
COPY --from=web30-builder /app/packages/web30/.next/static /app/web30/.next/static


# Download and install DDA binary
RUN mkdir -p /app/bin && \
    wget https://snl.salk.edu/~sfdraeger/dda/downloads/run_DDA_EPILEPSY -O /app/bin/run_DDA_ASCII && \
    chmod +x /app/bin/run_DDA_ASCII

# Check binary dependencies
RUN ldd /app/bin/run_DDA_ASCII || echo "Binary check completed"

# Create necessary directories including config directories
RUN mkdir -p /tmp/.dda /tmp/prometheus /app/data /app/api/.config /etc/ddalab /config && \
    chmod 777 /tmp/.dda

# Copy default configuration (baked-in)
COPY config/default.yml /etc/ddalab/config.yml

# Copy enhanced entrypoint script
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy legacy start script (still used by entrypoint)
COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

# Create non-root user
RUN useradd -m -s /bin/bash ddalabuser && \
    chown -R ddalabuser:ddalabuser /app /tmp/.dda /tmp/prometheus /etc/ddalab

# Expose ports
EXPOSE 8001 3000 3001

# Switch to non-root user
USER ddalabuser

WORKDIR /app

CMD ["/entrypoint.sh"]