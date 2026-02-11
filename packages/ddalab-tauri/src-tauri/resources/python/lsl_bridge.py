#!/usr/bin/env python3
"""
LSL WebSocket Bridge for DDALAB

Bridges pylsl stream discovery and data relay over a local WebSocket/HTTP server.
This sidecar process is managed by the Rust LslBridgeManager.

Endpoints:
  GET  /health           - Health check
  GET  /discover         - Discover available LSL streams
  WS   /stream           - Stream LSL data as JSON chunks

Usage:
  python3 lsl_bridge.py --port 17424
"""

import argparse
import asyncio
import json
import logging
import signal
import sys
import time
from http import HTTPStatus

import websockets
from websockets.http11 import Request, Response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("lsl_bridge")

try:
    import pylsl
except ImportError:
    logger.error(
        "pylsl is not installed. Install it with: pip install pylsl>=1.16.2"
    )
    sys.exit(1)


def discover_streams(timeout: float = 1.0) -> list[dict]:
    streams = pylsl.resolve_streams(timeout)
    result = []
    for info in streams:
        result.append(
            {
                "name": info.name(),
                "stream_type": info.type(),
                "channel_count": info.channel_count(),
                "sample_rate": info.nominal_srate(),
                "source_id": info.source_id(),
                "hostname": info.hostname(),
            }
        )
    return result


def extract_channel_names(info: pylsl.StreamInfo) -> list[str]:
    ch = info.desc().child("channels").child("channel")
    names = []
    while ch.value():
        label = ch.child_value("label")
        if label:
            names.append(label)
        ch = ch.next_sibling()
    if len(names) == info.channel_count():
        return names
    return [f"Ch{i + 1}" for i in range(info.channel_count())]


async def handle_stream(websocket):
    params = websocket.request.path.split("?", 1)
    query = {}
    if len(params) > 1:
        for pair in params[1].split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                from urllib.parse import unquote
                query[unquote(k)] = unquote(v)

    name = query.get("name", "")
    stream_type = query.get("type", "")
    source_id = query.get("source_id", "")
    max_samples = int(query.get("max_samples", "200"))

    predicates = []
    if name:
        predicates.append(f"name='{name}'")
    if stream_type:
        predicates.append(f"type='{stream_type}'")
    if source_id:
        predicates.append(f"source_id='{source_id}'")

    predicate = " and ".join(predicates) if predicates else ""

    logger.info(f"Stream request: predicate='{predicate}'")

    try:
        if predicate:
            streams = pylsl.resolve_bypred(predicate, 1, 5.0)
        else:
            streams = pylsl.resolve_streams(5.0)
    except Exception as e:
        await websocket.send(json.dumps({"error": f"Resolution failed: {e}"}))
        return

    if not streams:
        await websocket.send(json.dumps({"error": "No matching LSL stream found"}))
        return

    info = streams[0]
    channel_names = extract_channel_names(info)
    sample_rate = info.nominal_srate()

    inlet = pylsl.StreamInlet(info, max_buflen=360, max_chunklen=max_samples)
    inlet.open_stream()

    logger.info(
        f"Opened inlet: name='{info.name()}', type='{info.type()}', "
        f"channels={info.channel_count()}, rate={sample_rate}"
    )

    sequence = 0
    try:
        while True:
            samples, timestamps = inlet.pull_chunk(
                timeout=0.05, max_samples=max_samples
            )
            if not samples:
                await asyncio.sleep(0.01)
                continue

            num_channels = len(samples[0]) if samples else 0
            num_samples_pulled = len(samples)

            channels = [[] for _ in range(num_channels)]
            for sample in samples:
                for ch_idx, val in enumerate(sample):
                    channels[ch_idx].append(val)

            ts = timestamps[-1] if timestamps else time.time()

            chunk = {
                "samples": channels,
                "timestamp": ts,
                "sample_rate": sample_rate,
                "channel_names": channel_names,
                "sequence": sequence,
            }
            sequence += 1

            try:
                await websocket.send(json.dumps(chunk))
            except websockets.ConnectionClosed:
                break

    except websockets.ConnectionClosed:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"Stream error: {e}")
    finally:
        inlet.close_stream()
        logger.info("Inlet closed")


async def process_request(connection, request):
    path = request.path.split("?")[0]

    if path == "/health":
        body = json.dumps(
            {"status": "ok", "pylsl_version": pylsl.__version__}
        ).encode()
        return Response(
            HTTPStatus.OK,
            "OK",
            websockets.Headers({"Content-Type": "application/json"}),
            body,
        )

    if path == "/discover":
        query = {}
        if "?" in request.path:
            for pair in request.path.split("?", 1)[1].split("&"):
                if "=" in pair:
                    k, v = pair.split("=", 1)
                    from urllib.parse import unquote
                    query[unquote(k)] = unquote(v)

        timeout = float(query.get("timeout", "1.0"))
        stream_type = query.get("type", "")

        loop = asyncio.get_event_loop()
        streams = await loop.run_in_executor(None, discover_streams, timeout)

        if stream_type:
            streams = [s for s in streams if s["stream_type"] == stream_type]

        body = json.dumps(streams).encode()
        return Response(
            HTTPStatus.OK,
            "OK",
            websockets.Headers({"Content-Type": "application/json"}),
            body,
        )

    if path == "/stream":
        return None

    return Response(HTTPStatus.NOT_FOUND, "Not Found", websockets.Headers(), b"")


async def main(port: int):
    stop_event = asyncio.Event()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            signal.signal(sig, lambda s, f: stop_event.set())

    async with websockets.serve(
        handle_stream,
        "127.0.0.1",
        port,
        process_request=process_request,
    ):
        logger.info(f"LSL bridge listening on 127.0.0.1:{port}")
        await stop_event.wait()

    logger.info("LSL bridge shutting down")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DDALAB LSL Bridge")
    parser.add_argument("--port", type=int, default=17424, help="Port to listen on")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port))
    except KeyboardInterrupt:
        pass
