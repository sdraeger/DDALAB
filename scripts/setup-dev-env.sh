#!/bin/bash
# Development environment setup script for DDALAB

set -e

echo "🚀 Setting up DDALAB development environment..."
echo ""

# Check for required tools
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo "❌ $1 is not installed"
        return 1
    else
        echo "✅ $1 is installed"
        return 0
    fi
}

echo "Checking required tools..."
echo ""

# Docker
if ! check_command docker; then
    echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check if using Volta or nvm
USING_VOLTA=false
USING_NVM=false

if check_command volta; then
    USING_VOLTA=true
    echo "   Volta version: $(volta --version)"
elif check_command nvm; then
    USING_NVM=true
    echo "   nvm detected"
else
    echo ""
    echo "❌ Neither Volta nor nvm is installed"
    echo ""
    echo "We recommend installing Volta for Node.js version management:"
    echo "  curl https://get.volta.sh | bash"
    echo ""
    echo "Or install nvm:"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo ""
    read -p "Continue without Node version management? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# direnv (optional but recommended)
if ! check_command direnv; then
    echo ""
    echo "📌 direnv is not installed (optional but recommended)"
    echo "   Install with: brew install direnv"
    echo "   Then add to your shell: eval \"\$(direnv hook bash)\""
fi

echo ""
echo "Setting up Node.js environment..."

# Install Node if using Volta
if [[ "$USING_VOLTA" == "true" ]]; then
    echo "Installing Node.js via Volta..."
    volta install node@20
    volta install npm@10
elif [[ "$USING_NVM" == "true" ]]; then
    echo "Installing Node.js via nvm..."
    nvm install 20
    nvm use 20
fi

# Create necessary directories
echo ""
echo "Creating directories..."
mkdir -p data
mkdir -p certs
mkdir -p scripts

# Copy environment files if they don't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cp .env.example .env 2>/dev/null || echo "No .env.example found, skipping..."
fi

if [ ! -f .env.local ]; then
    echo "Creating .env.local file..."
    cat > .env.local << 'EOF'
# Local development overrides
NODE_ENV=development
DDALAB_AUTH_MODE=local

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=ddalab
POSTGRES_PASSWORD=ddalab
POSTGRES_DB=ddalab

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# MinIO
MINIO_HOST=localhost
MINIO_PORT=9000
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# API
API_HOST=localhost
API_PORT=8001
NEXT_PUBLIC_API_URL=http://localhost:8001
EOF
    echo "Created .env.local with default values"
fi

# Setup direnv if installed
if command -v direnv &> /dev/null; then
    echo ""
    echo "Setting up direnv..."
    if [ ! -f .envrc ]; then
        echo "❌ .envrc file not found, but it should have been created"
    else
        direnv allow .
        echo "✅ direnv configured and allowed"
    fi
fi

# Install dependencies
echo ""
echo "Installing Node.js dependencies..."
npm install

# Python setup
echo ""
echo "Setting up Python environment..."
if command -v python3 &> /dev/null; then
    echo "Creating Python virtual environment..."
    cd packages/api
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    cd ../..
    echo "✅ Python environment created"
else
    echo "❌ Python 3 not found, skipping Python setup"
fi

# Start core services
echo ""
echo "Starting core Docker services..."
if [ -f scripts/docker-profiles.sh ]; then
    ./scripts/docker-profiles.sh core
else
    docker compose up -d postgres redis minio
fi

echo ""
echo "🎉 Development environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Review and update .env.local with your settings"
echo "2. Run 'npm run dev' to start the development servers"
echo "3. Access the application at http://localhost:3000"
echo ""
echo "Useful commands:"
echo "  npm run dev              - Start all development servers"
echo "  ./scripts/docker-profiles.sh dev  - Start Docker development profile"
echo "  npm test                 - Run tests"
echo "  npm run build           - Build all packages"
echo ""

# If direnv is installed and configured
if command -v direnv &> /dev/null && [ -f .envrc ]; then
    echo "💡 Tip: cd out and back into this directory to load direnv"
fi