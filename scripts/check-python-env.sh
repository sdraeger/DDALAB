#!/bin/bash
# Quick check and setup for Python environment

set -e

# Check if virtual environment exists
if [ ! -d "packages/api/.venv" ]; then
    echo "🔧 Setting up Python virtual environment..."
    
    if ! command -v python3 &> /dev/null; then
        echo "❌ Python 3 is required but not found. Please install Python 3.10+"
        exit 1
    fi
    
    cd packages/api
    python3 -m venv .venv
    source .venv/bin/activate
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    cd ../..
    
    echo "✅ Python environment ready"
else
    echo "✅ Python environment already exists"
fi