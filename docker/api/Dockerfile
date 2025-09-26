# Multi-stage Dockerfile for DDALAB API
# Supports both amd64 and arm64 architectures

# Stage 1: Python dependencies
FROM python:3.11-slim as python-deps

WORKDIR /tmp

# Install system dependencies for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements files
COPY packages/api/requirements.txt ./requirements.txt
COPY packages/api/requirements-dev.txt ./requirements-dev.txt

# Create virtual environment and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim as runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1000 ddalab && \
    useradd -m -u 1000 -g ddalab ddalab

# Copy virtual environment from builder
COPY --from=python-deps /opt/venv /opt/venv

# Set environment variables
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PORT=8000

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=ddalab:ddalab packages/api/ .

# Create necessary directories
RUN mkdir -p /app/uploads /app/logs && \
    chown -R ddalab:ddalab /app

# Switch to non-root user
USER ddalab

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE ${PORT}

# Add labels for metadata
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.title="DDALAB API" \
      org.opencontainers.image.description="FastAPI backend for DDALAB EEG analysis platform" \
      org.opencontainers.image.authors="DDALAB Team" \
      org.opencontainers.image.vendor="DDALAB" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/DDALAB/DDALAB" \
      org.opencontainers.image.licenses="MIT"

# Run the application
CMD ["python", "-m", "uvicorn", "server.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "4", \
     "--loop", "uvloop", \
     "--access-log"]