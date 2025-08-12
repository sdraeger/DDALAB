#!/bin/bash

# DDALAB Web 2.0 Setup Script

echo "🚀 Setting up DDALAB Web 2.0..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo "📝 Creating .env.local file..."
    cat > .env.local << EOF
# Environment Variables
NEXT_PUBLIC_APP_NAME=DDALAB
NEXT_PUBLIC_APP_VERSION=1.0.0
NEXT_PUBLIC_API_URL=http://localhost:3000/api
EOF
    echo "✅ Created .env.local"
fi

# Check if TypeScript is properly configured
echo "🔍 Checking TypeScript configuration..."
npx tsc --noEmit

if [ $? -eq 0 ]; then
    echo "✅ TypeScript configuration is valid"
else
    echo "❌ TypeScript configuration has errors"
    exit 1
fi

echo ""
echo "🎉 Setup complete! You can now run:"
echo "  npm run dev    # Start development server"
echo "  npm run build  # Build for production"
echo "  npm run test   # Run tests"
echo ""
echo "🌐 DDALAB Web 2.0 will be available at: http://localhost:3001"
