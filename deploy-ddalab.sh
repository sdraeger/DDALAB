#!/bin/bash

# DDALAB Docker Deployment Script
# This script sets up DDALAB using Docker containers

set -e

echo "🚀 DDALAB Docker Deployment Script"
echo "=================================="

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Docker is installed and running"

# Create deployment directory
DEPLOY_DIR="${1:-./ddalab}"
echo "📁 Creating deployment directory: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Create subdirectories
mkdir -p "$DEPLOY_DIR/data"
mkdir -p "$DEPLOY_DIR/dynamic"
mkdir -p "$DEPLOY_DIR/certs"
mkdir -p "$DEPLOY_DIR/traefik-logs"

# Download configuration files
echo "📥 Setting up configuration files..."

# Copy docker-compose.yml
cp docker-compose.yml "$DEPLOY_DIR/docker-compose.yml"

# Create .env file with Docker Hub images
cat > "$DEPLOY_DIR/.env" << 'EOF'
# DDALAB Docker Deployment Configuration
# This file configures DDALAB to use Docker Hub images

# Use Docker Hub images instead of building locally
DDALAB_WEB_IMAGE=ddalab/web:latest
DDALAB_API_IMAGE=ddalab/api:latest

# Database Configuration
DDALAB_DB_USER=ddalab
DDALAB_DB_PASSWORD=ddalab_password
DDALAB_DB_NAME=ddalab

# MinIO Configuration
MINIO_ROOT_USER=ddalab
MINIO_ROOT_PASSWORD=ddalab_password

# Redis Configuration (optional)
DDALAB_REDIS_PASSWORD=
DDALAB_REDIS_USE_SSL=False

# Data Directory (where your EDF files will be stored)
DDALAB_DATA_DIR=./data

# Web Application Port
WEB_PORT=3000

# Session Configuration
SESSION_EXPIRATION=10080

# Traefik Configuration
TRAEFIK_ACME_EMAIL=admin@ddalab.local
TRAEFIK_PASSWORD_HASH=

# Cache Configuration
DDALAB_PLOT_CACHE_TTL=3600

# Allowed Directories for API access
DDALAB_ALLOWED_DIRS=./data:/app/data:rw

# Grafana Configuration (optional)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=admin

# Next.js Environment Variables
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF

# Copy traefik.yml
cp traefik.yml "$DEPLOY_DIR/traefik.yml"

# Copy dynamic configuration
cp dynamic/routers.yml "$DEPLOY_DIR/dynamic/routers.yml"

# Create empty acme.json file
echo "{}" > "$DEPLOY_DIR/acme.json"

echo "✅ Configuration files created successfully"

# Pull Docker images
echo "📦 Pulling Docker images..."
docker pull ddalab/api:latest
docker pull ddalab/web:latest

echo "🚀 Starting DDALAB services..."
cd "$DEPLOY_DIR"
docker-compose up -d

echo ""
echo "🎉 DDALAB deployment completed successfully!"
echo ""
echo "📋 Service Information:"
echo "  • Web Interface: http://localhost:3000"
echo "  • API Server: http://localhost:8001"
echo "  • MinIO Console: http://localhost:9001"
echo "  • PostgreSQL: localhost:5432"
echo "  • Redis: localhost:6379"
echo "  • Grafana: http://localhost:3005"
echo "  • Prometheus: http://localhost:9090"
echo "  • Jaeger UI: http://localhost:16686"
echo ""
echo "📁 Data Directory: $DEPLOY_DIR/data"
echo ""
echo "🔧 Management Commands:"
echo "  • View logs: cd $DEPLOY_DIR && docker-compose logs -f"
echo "  • Stop services: cd $DEPLOY_DIR && docker-compose down"
echo "  • Restart services: cd $DEPLOY_DIR && docker-compose restart"
echo "  • Update images: cd $DEPLOY_DIR && docker-compose pull && docker-compose up -d"
echo ""
echo "⚠️  Default credentials:"
echo "  • Database: ddalab / ddalab_password"
echo "  • MinIO: ddalab / ddalab_password"
echo "  • Grafana: admin / admin"
echo ""
echo "🔒 For production use, please change the default passwords in the .env file."
