from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


def load_demo_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        normalized = line.strip()
        if not normalized or normalized.startswith("#") or "=" not in normalized:
            continue
        key, value = normalized.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_demo_env(Path(__file__).resolve().parents[1] / "demo.env")

COMPOSE_DIR = Path(__file__).resolve().parents[1]
COMPOSE_FILE = COMPOSE_DIR / "docker-compose.yml"
ADMIN_USERNAME = os.getenv("ZONIX_DEMO_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ZONIX_DEMO_ADMIN_PASSWORD", "local-dev-admin-change-me")


def resolve_running_backend_port() -> str | None:
    try:
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                str(COMPOSE_DIR / "demo.env"),
                "-f",
                str(COMPOSE_FILE),
                "port",
                "backend",
                "8000",
            ],
            cwd=str(COMPOSE_DIR),
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    published = result.stdout.strip()
    if not published:
        return None
    return published.rsplit(":", 1)[-1]


def resolve_base_url() -> str:
    explicit_base_url = os.getenv("ZONIX_DEMO_BASE_URL")
    if explicit_base_url:
        return explicit_base_url.rstrip("/") + "/"

    backend_port = (
        resolve_running_backend_port()
        or os.getenv("ZONIX_HOST_BACKEND_PORT")
        or "8000"
    )
    return f"http://127.0.0.1:{backend_port}/"


BASE_URL = resolve_base_url()


def expect_status(response, expected_status: int, context: str) -> None:
    if response.status != expected_status:
        raise RuntimeError(f"{context} returned {response.status}, expected {expected_status}")


def main() -> int:
    cookies = CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookies))

    def json_request(path: str, *, method: str = "GET", payload: dict[str, object] | None = None):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(urljoin(BASE_URL, path.lstrip("/")), data=body, headers=headers, method=method)
        return opener.open(request, timeout=5)

    try:
        with json_request("/health") as response:
            expect_status(response, 200, "health")
            health = json.load(response)

        with json_request("/ready") as response:
            expect_status(response, 200, "ready")
            ready = json.load(response)

        with json_request("/metrics") as response:
            expect_status(response, 200, "metrics")
            metrics_body = response.read().decode("utf-8")

        with json_request(
            "/auth/login",
            method="POST",
            payload={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        ) as response:
            expect_status(response, 200, "login")
            session = json.load(response)

        with json_request("/auth/me") as response:
            expect_status(response, 200, "auth/me")
            me = json.load(response)

        with json_request("/zones") as response:
            expect_status(response, 200, "zones")
            zones = json.load(response)
    except (HTTPError, URLError, TimeoutError, RuntimeError) as error:
        print(f"Demo verification failed: {error}", file=sys.stderr)
        return 1

    print("Demo verification passed.")
    print(f"Health: {health['status']} | Ready: {ready['status']}")
    print(f"Authenticated as: {me['user']['username'] if me.get('user') else 'anonymous'}")
    print(f"Zones visible: {len(zones.get('items', []))}")
    if "zonix_http_requests_total" not in metrics_body:
        print("Warning: metrics endpoint did not expose request counters.", file=sys.stderr)
        return 1
    if not session.get("authenticated"):
        print("Warning: login response was not authenticated.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
