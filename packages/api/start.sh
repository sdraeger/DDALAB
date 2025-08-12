#!/bin/sh
# Start the Python API server via Uvicorn

HOST=${API_HOST:-0.0.0.0}
PORT=${API_PORT:-8001}

exec uvicorn main:app --host "$HOST" --port "$PORT"
