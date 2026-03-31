from __future__ import annotations

import json
import logging
import threading
from collections import defaultdict
from dataclasses import dataclass
from time import perf_counter

from fastapi import Request, Response


REQUEST_LOGGER_NAME = "zonix.http"


def _format_metric_labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    serialized = ",".join(
        f'{key}="{value.replace("\\", "\\\\").replace("\"", "\\\"")}"'
        for key, value in sorted(labels.items())
    )
    return f"{{{serialized}}}"


@dataclass(frozen=True)
class RequestMetricKey:
    method: str
    path: str
    status_code: int


class MetricsRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._request_counts: dict[RequestMetricKey, int] = defaultdict(int)
        self._request_duration_seconds: dict[RequestMetricKey, float] = defaultdict(float)
        self._in_progress_requests = 0

    def track_request(self, method: str, path: str, status_code: int, duration_seconds: float) -> None:
        key = RequestMetricKey(
            method=method.upper(),
            path=path,
            status_code=status_code,
        )
        with self._lock:
            self._request_counts[key] += 1
            self._request_duration_seconds[key] += duration_seconds

    def increment_in_progress(self) -> None:
        with self._lock:
            self._in_progress_requests += 1

    def decrement_in_progress(self) -> None:
        with self._lock:
            self._in_progress_requests = max(0, self._in_progress_requests - 1)

    def render_prometheus(self, *, app_name: str, app_version: str, environment: str) -> str:
        with self._lock:
            request_counts = dict(self._request_counts)
            request_durations = dict(self._request_duration_seconds)
            in_progress_requests = self._in_progress_requests

        lines = [
            "# HELP zonix_build_info Build metadata for the running Zonix instance.",
            "# TYPE zonix_build_info gauge",
            f'zonix_build_info{{app="{app_name}",version="{app_version}",environment="{environment}"}} 1',
            "# HELP zonix_http_requests_in_progress Requests currently being processed.",
            "# TYPE zonix_http_requests_in_progress gauge",
            f"zonix_http_requests_in_progress {in_progress_requests}",
            "# HELP zonix_http_requests_total Total HTTP requests handled by the API.",
            "# TYPE zonix_http_requests_total counter",
        ]

        for key in sorted(
            request_counts,
            key=lambda item: (item.path, item.method, item.status_code),
        ):
            labels = _format_metric_labels(
                {
                    "method": key.method,
                    "path": key.path,
                    "status_code": str(key.status_code),
                }
            )
            lines.append(f"zonix_http_requests_total{labels} {request_counts[key]}")

        lines.extend(
            [
                "# HELP zonix_http_request_duration_seconds Total request latency in seconds.",
                "# TYPE zonix_http_request_duration_seconds counter",
            ]
        )
        for key in sorted(
            request_durations,
            key=lambda item: (item.path, item.method, item.status_code),
        ):
            labels = _format_metric_labels(
                {
                    "method": key.method,
                    "path": key.path,
                    "status_code": str(key.status_code),
                }
            )
            lines.append(
                f"zonix_http_request_duration_seconds{labels} "
                f"{request_durations[key]:.6f}"
            )

        return "\n".join(lines) + "\n"


class RequestObservabilityMiddleware:
    def __init__(self, metrics_registry: MetricsRegistry) -> None:
        self.metrics_registry = metrics_registry
        self.logger = logging.getLogger(REQUEST_LOGGER_NAME)

    async def __call__(self, request: Request, call_next) -> Response:
        started_at = perf_counter()
        self.metrics_registry.increment_in_progress()
        status_code = 500
        route_path = request.url.path
        try:
            response = await call_next(request)
            status_code = response.status_code
            route = request.scope.get("route")
            if route is not None and getattr(route, "path", None):
                route_path = route.path
            return response
        finally:
            duration_seconds = perf_counter() - started_at
            self.metrics_registry.decrement_in_progress()
            self.metrics_registry.track_request(
                request.method,
                route_path,
                status_code,
                duration_seconds,
            )
            self.logger.info(
                json.dumps(
                    {
                        "event": "http_request",
                        "method": request.method,
                        "path": request.url.path,
                        "route": route_path,
                        "status_code": status_code,
                        "duration_ms": round(duration_seconds * 1000, 3),
                    },
                    sort_keys=True,
                )
            )
