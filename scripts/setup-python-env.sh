#!/bin/bash
# Setup Python virtual environment for the API

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🐍 Setting up Python environment for DDALAB API${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "packages/api/requirements.txt" ]; then
    echo -e "${RED}Error: Please run this script from the project root directory${NC}"
    exit 1
fi

cd packages/api

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Install Python 3.10+ from https://python.org/"
    exit 1
fi

echo "Python version: $(python3 --version)"
echo ""

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv .venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
else
    echo -e "${GREEN}✅ Virtual environment already exists${NC}"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Upgrade pip
echo "Upgrading pip..."
python -m pip install --upgrade pip

# Install requirements
echo "Installing Python dependencies..."
pip install -r requirements.txt

echo ""
echo -e "${GREEN}🎉 Python environment setup complete!${NC}"
echo ""
echo "To activate the environment manually:"
echo "  cd packages/api"
echo "  source .venv/bin/activate"
echo ""
echo "The start.sh script will automatically activate this environment."