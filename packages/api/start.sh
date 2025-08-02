#!/bin/bash

until nc -z "${DDALAB_DB_HOST:-postgres}" "${DDALAB_DB_PORT:-5432}"; do
	echo 'Waiting for PostgreSQL...';
	sleep 1;
done;

python apply_sql_files.py \
	--dbname "${DDALAB_DB_NAME:-ddalab}" \
	--user "${DDALAB_DB_USER:-admin}" \
	--password "${DDALAB_DB_PASSWORD:-dev_password123}" \
	--host "${DDALAB_DB_HOST:-postgres}" \
	--port "${DDALAB_DB_PORT:-5432}" \
	--email admin@example.com \
	--first_name Admin \
	--last_name User

mkdir -p /tmp/prometheus
chown apiuser:apiuser /tmp/prometheus
chmod 775 /tmp/prometheus

# Start the main API server on port 8001
uvicorn main:app --host 0.0.0.0 --port 8001 --workers 2 &

# Start the metrics server on port 8002
uvicorn main:app_metrics --host 0.0.0.0 --port 8002 --workers 1
