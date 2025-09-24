#!/bin/bash

# DDALAB Tauri Development Setup Script

set -e

echo "🚀 Setting up DDALAB Tauri development environment..."

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js $(node --version) found"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm $(npm --version) found"

# Check Rust
if ! command -v rustc &> /dev/null; then
    echo "⚠️  Rust is not installed. Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
    echo "✅ Rust installed successfully"
else
    echo "✅ Rust $(rustc --version | cut -d ' ' -f 2) found"
fi

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Install Tauri CLI globally if not present
if ! command -v tauri &> /dev/null; then
    echo "🔧 Installing Tauri CLI..."
    npm install -g @tauri-apps/cli
    echo "✅ Tauri CLI installed"
else
    echo "✅ Tauri CLI found"
fi

# Create development environment file
if [ ! -f .env.local ]; then
    echo "⚙️  Creating development environment file..."
    cat > .env.local << EOF
# DDALAB Tauri Development Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_APP_ENV=development
EOF
    echo "✅ Created .env.local"
fi

# Create src-tauri directory if it doesn't exist (shouldn't happen but safety check)
if [ ! -d "src-tauri" ]; then
    echo "❌ src-tauri directory missing. Please run this script from the correct directory."
    exit 1
fi

echo ""
echo "🎉 Setup complete! You can now:"
echo ""
echo "  📱 Start web development server:"
echo "     npm run dev"
echo ""
echo "  🖥️  Start desktop app in development:"
echo "     npm run desktop:dev"
echo ""
echo "  🔨 Build for production:"
echo "     npm run desktop:build"
echo ""
echo "⚠️  Note: Make sure the DDALAB Python API server is running on http://localhost:8000"
echo "   You can start it from the main DDALAB directory with: npm run dev"
echo ""