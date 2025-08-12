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
npm run start -- --port 3000 &
WEB_PID=$!

# Wait for both processes to finish
wait $API_PID
wait $WEB_PID
