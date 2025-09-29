#!/bin/bash
# One-time development environment setup

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Setting up DDALAB Development Environment${NC}"
echo ""

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Setup Python environment
echo ""
echo "🐍 Setting up Python environment..."
./scripts/check-python-env.sh

# Create .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo ""
    echo "⚙️  Creating .env.local for local development..."
    cat > .env.local << 'EOF'
# Local development environment variables
NODE_ENV=development
DDALAB_AUTH_MODE=local

# Database (for local development, use localhost)
DB_HOST=localhost
DB_USER=admin
DB_PASSWORD=ddalab_password
DB_NAME=ddalab

# MinIO (for local development, use localhost)
MINIO_HOST=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# API
API_HOST=localhost
API_PORT=8001
NEXT_PUBLIC_API_URL=http://localhost:8001
EOF
    echo "✅ Created .env.local"
else
    echo "✅ .env.local already exists"
fi

echo ""
echo -e "${GREEN}🎉 Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Start infrastructure: ./scripts/docker-profiles.sh core"
echo "2. Start development: npm run dev:local"
echo ""
echo "Or use Docker for everything: npm run dev:docker"