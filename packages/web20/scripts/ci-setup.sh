#!/bin/bash

# CI Setup Script for E2E Tests
# This script ensures the environment is ready for Playwright tests in CI

set -e

echo "🔧 Setting up CI environment for E2E tests..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install --silent

# Patch Next.js SWC dependencies if needed
echo "🔨 Patching Next.js dependencies..."
npx next@latest telemetry disable || true

# Create minimal .env if it doesn't exist
if [[ ! -f "../../.env" ]]; then
    echo "📝 Creating minimal .env file..."
    touch "../../.env"
fi

echo "✅ CI environment setup complete"