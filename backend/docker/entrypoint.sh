#!/bin/sh
set -eu

python - <<'PY'
from __future__ import annotations

import os
import socket
import sys
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def wait_for_tcp(host: str, port: int, label: str, timeout_seconds: float = 60.0) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=2.0):
                print(f"{label} is reachable at {host}:{port}")
                return
        except OSError:
            time.sleep(1.0)
    raise SystemExit(f"Timed out waiting for {label} at {host}:{port}")


def wait_for_http(
    url: str,
    label: str,
    timeout_seconds: float = 60.0,
    headers: dict[str, str] | None = None,
) -> None:
    deadline = time.time() + timeout_seconds
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    request = Request(url, headers=request_headers)
    while time.time() < deadline:
        try:
            with urlopen(request, timeout=3.0) as response:  # noqa: S310
                if response.status < 500:
                    print(f"{label} is reachable at {url}")
                    return
        except Exception:
            time.sleep(1.0)
    raise SystemExit(f"Timed out waiting for {label} at {url}")


database_url = os.getenv("ZONIX_DATABASE_URL", "")
if database_url:
    parsed = urlparse(database_url)
    if parsed.hostname and parsed.port:
        wait_for_tcp(parsed.hostname, parsed.port, "postgres")

if os.getenv("ZONIX_POWERDNS_BACKEND_ENABLED", "true").lower() in {"1", "true", "yes", "on"}:
    powerdns_api_url = os.getenv("ZONIX_POWERDNS_API_URL", "").rstrip("/")
    if powerdns_api_url:
        powerdns_headers = {}
        powerdns_api_key = os.getenv("ZONIX_POWERDNS_API_KEY", "")
        if powerdns_api_key:
            powerdns_headers["X-API-Key"] = powerdns_api_key
        wait_for_http(
            f"{powerdns_api_url}/api/v1/servers",
            "powerdns api",
            headers=powerdns_headers,
        )

if os.getenv("ZONIX_BIND_BACKEND_ENABLED", "false").lower() in {"1", "true", "yes", "on"}:
    bind_host = os.getenv("ZONIX_BIND_SERVER_HOST", "")
    bind_port = int(os.getenv("ZONIX_BIND_SERVER_PORT", "53"))
    if bind_host:
        wait_for_tcp(bind_host, bind_port, "bind dns")
PY

python -m app.migrations
python -m app.bootstrap

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
