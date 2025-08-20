#!/bin/sh
set -e

# Start the API server in the background
cd /app/api
/app/api/start.sh &
API_PID=$!

# Start the Next.js web20 server in the background
cd /app/web20
# Respect runtime env for API URL if provided
export NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:8001}
# Use standalone server for production
if [ -f ".next/standalone/server.js" ]; then
    echo "Starting Next.js in standalone mode..."
    # Set port and hostname for standalone server
    export PORT=3000
    export HOSTNAME=0.0.0.0
    node .next/standalone/server.js &
else
    echo "Standalone build not found, falling back to npm start..."
    npm run start -- --port 3000 &
fi
WEB_PID=$!

# Wait for both processes to finish
wait $API_PID
wait $WEB_PID
