# Development container
FROM node:20-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    curl \
    git \
    vim \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Install global tools
RUN npm install -g turbo@latest npm@latest

# Create app directory
WORKDIR /app

# Install Python package manager
RUN pip3 install --upgrade pip

# Set environment variables
ENV PYTHONPATH=/app/packages/api:${PYTHONPATH}
ENV NODE_ENV=development

# Expose ports for all services
EXPOSE 3000 3001 8001 5432 6379 9000 9001 9229

# Default command
CMD ["bash"]
