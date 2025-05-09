#!/bin/bash

until nc -z postgres 5432; do
	echo 'Waiting for PostgreSQL...';
	sleep 1;
done;

python server/apply_sql_files.py \
	--username admin \
	--password AdminPassword123 \
	--email admin@example.com \
	--first_name Admin \
	--last_name User

mkdir -p /tmp/prometheus
chown apiuser:apiuser /tmp/prometheus
chmod 775 /tmp/prometheus

# Start the main API server on port 8001
uvicorn server.main:app --host 0.0.0.0 --port 8001 --workers 2 &

# Start the metrics server on port 8002
uvicorn server.main:app_metrics --host 0.0.0.0 --port 8002 --workers 1
