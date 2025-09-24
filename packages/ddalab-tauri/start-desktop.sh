#!/bin/bash

# DDALAB Tauri Desktop Development Script

echo "🚀 Starting DDALAB Desktop Application..."

# Kill any existing Next.js dev servers
pkill -f "next dev" 2>/dev/null || true

# Function to cleanup on exit
cleanup() {
    echo "🧹 Cleaning up..."
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "tauri dev" 2>/dev/null || true
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup INT TERM EXIT

# Start Next.js dev server in background
echo "📱 Starting Next.js development server..."
npm run dev &
NEXTJS_PID=$!

# Wait for Next.js to be ready
echo "⏳ Waiting for Next.js server to start..."
for i in {1..30}; do
    if curl -s http://localhost:3003 > /dev/null 2>&1; then
        echo "✅ Next.js server is ready at http://localhost:3003"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Next.js server failed to start after 30 seconds"
        exit 1
    fi
    sleep 1
done

# Start Tauri desktop app
echo "🖥️  Starting Tauri desktop application..."
npm run tauri:dev

# If we get here, Tauri has exited
echo "👋 DDALAB Desktop Application closed"