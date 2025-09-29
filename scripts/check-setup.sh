#!/bin/bash
# Development environment health check

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 DDALAB Development Environment Check"
echo "======================================"
echo ""

# Function to check if command exists
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "✅ $1: ${GREEN}$(command -v $1)${NC}"
        return 0
    else
        echo -e "❌ $1: ${RED}Not found${NC}"
        return 1
    fi
}

# Function to check if file exists
check_file() {
    if [ -f "$1" ]; then
        echo -e "✅ $1: ${GREEN}Found${NC}"
        return 0
    else
        echo -e "❌ $1: ${RED}Missing${NC}"
        return 1
    fi
}

# Function to check if directory exists
check_dir() {
    if [ -d "$1" ]; then
        echo -e "✅ $1: ${GREEN}Found${NC}"
        return 0
    else
        echo -e "❌ $1: ${RED}Missing${NC}"
        return 1
    fi
}

# Check required commands
echo "🔧 Checking Required Commands:"
check_command "node" || echo "   Install Node.js: https://nodejs.org/"
check_command "npm" || echo "   Install npm (comes with Node.js)"
check_command "python3" || echo "   Install Python 3.10+: https://python.org/"
check_command "docker" || echo "   Install Docker: https://docker.com/"
echo ""

# Check optional commands
echo "🛠️  Checking Optional Commands:"
check_command "volta" || echo "   Install Volta: curl https://get.volta.sh | bash"
check_command "direnv" || echo "   Install direnv: brew install direnv"
check_command "concurrently" && echo "   (globally installed)" || echo "   Install: npm install -g concurrently"
echo ""

# Check project structure
echo "📁 Checking Project Structure:"
check_dir "packages"
check_dir "packages/api"
check_dir "packages/web20"
check_dir "scripts"
check_file "packages/api/start.sh"
check_file "packages/api/requirements.txt"
check_file "packages/web20/package.json"
check_file "docker-compose.dev.yml"
echo ""

# Check configuration files
echo "⚙️  Checking Configuration:"
check_file ".env" || echo "   Create from .env.example if available"
check_file "package.json"
check_file "turbo.json"
if [ -f ".envrc" ]; then
    echo -e "✅ .envrc: ${GREEN}Found (direnv configured)${NC}"
else
    echo -e "ℹ️  .envrc: ${YELLOW}Not found (direnv not configured)${NC}"
fi
echo ""

# Check Node.js dependencies
echo "📦 Checking Dependencies:"
if [ -f "node_modules/.bin/concurrently" ]; then
    echo -e "✅ concurrently: ${GREEN}Installed${NC}"
else
    echo -e "❌ concurrently: ${RED}Missing - run 'npm install'${NC}"
fi

if [ -f "node_modules/.bin/turbo" ]; then
    echo -e "✅ turbo: ${GREEN}Installed${NC}"
else
    echo -e "❌ turbo: ${RED}Missing - run 'npm install'${NC}"
fi
echo ""

# Check Python environment
echo "🐍 Checking Python Environment:"
if [ -d "packages/api/.venv" ]; then
    echo -e "✅ Python venv: ${GREEN}Found${NC}"
    if [ -f "packages/api/.venv/bin/activate" ]; then
        echo -e "✅ Activation script: ${GREEN}Found${NC}"
    fi
else
    echo -e "❌ Python venv: ${RED}Missing${NC}"
    echo "   Create with: cd packages/api && python3 -m venv .venv"
    echo "   Then: source .venv/bin/activate && pip install -r requirements.txt"
fi
echo ""

# Check Docker
echo "🐳 Checking Docker:"
if docker info &> /dev/null; then
    echo -e "✅ Docker daemon: ${GREEN}Running${NC}"
    echo "   Docker version: $(docker --version)"
else
    echo -e "❌ Docker daemon: ${RED}Not running${NC}"
    echo "   Start Docker Desktop"
fi
echo ""

# Check ports
echo "🔌 Checking Ports:"
for port in 3000 8001 5432 6379 9000 9001; do
    if lsof -i :$port &> /dev/null; then
        echo -e "⚠️  Port $port: ${YELLOW}In use$(NC) (by $(lsof -ti :$port | head -1))"
    else
        echo -e "✅ Port $port: ${GREEN}Available${NC}"
    fi
done
echo ""

# Recommendations
echo "💡 Recommendations:"
if ! command -v volta &> /dev/null; then
    echo "   • Install Volta for Node.js version management"
fi

if ! command -v direnv &> /dev/null; then
    echo "   • Install direnv for automatic environment loading"
fi

if [ ! -f ".env.local" ]; then
    echo "   • Create .env.local for local configuration overrides"
fi

if [ ! -d "packages/api/.venv" ]; then
    echo "   • Set up Python virtual environment in packages/api"
fi

echo ""
echo "🚀 Quick Start Commands:"
echo "   npm run dev:docker          # Full Docker development"
echo "   npm run dev:docker:minimal  # Minimal Docker development"
echo "   npm run dev:local           # Local development"
echo "   ./scripts/dev.sh up         # Docker with all services"
echo ""