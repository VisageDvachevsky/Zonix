from __future__ import annotations

from os import getenv
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

PUBLIC_BASE_URL = getenv("OIDC_GATEWAY_PUBLIC_BASE_URL", "http://localhost:9010").rstrip("/")
INTERNAL_BASE_URL = getenv("OIDC_GATEWAY_INTERNAL_BASE_URL", "http://oidc-gateway:9000").rstrip("/")
UPSTREAM_BASE_URL = getenv("OIDC_GATEWAY_UPSTREAM_BASE_URL", "http://keycloak:8080").rstrip("/")
PUBLIC_HOST = urlparse(PUBLIC_BASE_URL).netloc

app = FastAPI(title="Zonix OIDC Gateway")


def _rewrite_discovery(payload: dict[str, object], realm: str) -> dict[str, object]:
    internal_realm_base = f"{INTERNAL_BASE_URL}/realms/{realm}"
    public_realm_base = f"{PUBLIC_BASE_URL}/realms/{realm}"
    rewritten = dict(payload)
    rewritten["issuer"] = internal_realm_base
    rewritten["authorization_endpoint"] = (
        f"{public_realm_base}/protocol/openid-connect/auth"
    )
    rewritten["token_endpoint"] = f"{internal_realm_base}/protocol/openid-connect/token"
    rewritten["userinfo_endpoint"] = (
        f"{internal_realm_base}/protocol/openid-connect/userinfo"
    )
    if "end_session_endpoint" in rewritten:
        rewritten["end_session_endpoint"] = (
            f"{public_realm_base}/protocol/openid-connect/logout"
        )
    return rewritten


def _rewrite_location(location: str) -> str:
    return location.replace(UPSTREAM_BASE_URL, PUBLIC_BASE_URL)


@app.get("/realms/{realm}/.well-known/openid-configuration")
async def openid_configuration(realm: str) -> JSONResponse:
    upstream_url = f"{UPSTREAM_BASE_URL}/realms/{realm}/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(upstream_url, headers={"Host": PUBLIC_HOST})
        response.raise_for_status()
    return JSONResponse(_rewrite_discovery(response.json(), realm))


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def proxy(path: str, request: Request) -> Response:
    upstream_url = f"{UPSTREAM_BASE_URL}/{path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    body = await request.body()
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {"host", "content-length"}
    }
    headers["Host"] = PUBLIC_HOST
    headers["X-Forwarded-Host"] = PUBLIC_HOST
    headers["X-Forwarded-Proto"] = urlparse(PUBLIC_BASE_URL).scheme or "http"

    async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
        upstream_response = await client.request(
            request.method,
            upstream_url,
            content=body,
            headers=headers,
        )

    response_headers = {
        key: value
        for key, value in upstream_response.headers.items()
        if key.lower()
        not in {
            "content-length",
            "transfer-encoding",
            "connection",
            "content-encoding",
            "set-cookie",
        }
    }
    if "location" in upstream_response.headers:
        response_headers["location"] = _rewrite_location(upstream_response.headers["location"])

    response = Response(
        content=upstream_response.content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
    for cookie in upstream_response.headers.get_list("set-cookie"):
        response.raw_headers.append((b"set-cookie", cookie.encode("latin-1")))
    return response
