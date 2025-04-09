#!/bin/bash

docker compose down

rm -rf grafana_data
rm -rf prometheus_data
rm -rf prometheus_metrics
rm -rf postgres-data
rm -rf redis-data
rm -rf minio-data
