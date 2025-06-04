from fastapi import APIRouter, Response
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)
from prometheus_client.multiprocess import MultiProcessCollector

router = APIRouter()
registry = CollectorRegistry()

# Define Prometheus metrics
REQUEST_COUNT = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "path", "status"],
    registry=registry,
)

REQUEST_LATENCY = Histogram(
    "request_duration_seconds",
    "Time spent processing requests",
    ["path"],
    registry=registry,
)


@router.get("")
async def metrics():
    MultiProcessCollector(registry)
    data = generate_latest(registry)
    return Response(content=data, media_type=CONTENT_TYPE_LATEST)
