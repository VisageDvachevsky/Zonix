import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient


def load_gateway_module():
    module_path = (
        Path(__file__).resolve().parents[2] / "deploy" / "oidc-gateway" / "app.py"
    )
    spec = importlib.util.spec_from_file_location("test_oidc_gateway_app", module_path)
    if spec is None or spec.loader is None:
        raise AssertionError("failed to load oidc gateway module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeUpstreamResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: list[tuple[str, str]] | None = None,
        json_payload: dict[str, object] | None = None,
        content: bytes = b"",
    ) -> None:
        self.status_code = status_code
        self.headers = httpx.Headers(headers or [])
        self._json_payload = json_payload
        self.content = content

    def json(self) -> dict[str, object]:
        if self._json_payload is None:
            raise AssertionError("json payload was not configured")
        return self._json_payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "http://keycloak:8080")
            response = httpx.Response(
                self.status_code,
                request=request,
                headers=self.headers,
                content=self.content,
            )
            raise httpx.HTTPStatusError("upstream failure", request=request, response=response)


class OIDCGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = patch.dict(
            os.environ,
            {
                "OIDC_GATEWAY_PUBLIC_BASE_URL": "http://localhost:9010",
                "OIDC_GATEWAY_INTERNAL_BASE_URL": "http://oidc-gateway:9000",
                "OIDC_GATEWAY_UPSTREAM_BASE_URL": "http://keycloak:8080",
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_discovery_rewrites_public_and_internal_endpoints(self) -> None:
        gateway = load_gateway_module()
        seen: dict[str, object] = {}

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                seen["client_kwargs"] = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str] | None = None):
                seen["url"] = url
                seen["headers"] = headers
                return FakeUpstreamResponse(
                    json_payload={
                        "issuer": "http://keycloak:8080/realms/zonix",
                        "authorization_endpoint": "http://keycloak:8080/realms/zonix/protocol/openid-connect/auth",
                        "token_endpoint": "http://keycloak:8080/realms/zonix/protocol/openid-connect/token",
                        "userinfo_endpoint": "http://keycloak:8080/realms/zonix/protocol/openid-connect/userinfo",
                        "end_session_endpoint": "http://keycloak:8080/realms/zonix/protocol/openid-connect/logout",
                    }
                )

        with patch.object(gateway.httpx, "AsyncClient", FakeAsyncClient):
            client = TestClient(gateway.app)
            response = client.get("/realms/zonix/.well-known/openid-configuration")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            seen["url"],
            "http://keycloak:8080/realms/zonix/.well-known/openid-configuration",
        )
        self.assertEqual(seen["headers"], {"Host": "localhost:9010"})
        self.assertEqual(
            response.json()["issuer"],
            "http://oidc-gateway:9000/realms/zonix",
        )
        self.assertEqual(
            response.json()["authorization_endpoint"],
            "http://localhost:9010/realms/zonix/protocol/openid-connect/auth",
        )
        self.assertEqual(
            response.json()["token_endpoint"],
            "http://oidc-gateway:9000/realms/zonix/protocol/openid-connect/token",
        )
        self.assertEqual(
            response.json()["userinfo_endpoint"],
            "http://oidc-gateway:9000/realms/zonix/protocol/openid-connect/userinfo",
        )
        self.assertEqual(
            response.json()["end_session_endpoint"],
            "http://localhost:9010/realms/zonix/protocol/openid-connect/logout",
        )

    def test_proxy_rewrites_location_and_preserves_multiple_cookies(self) -> None:
        gateway = load_gateway_module()
        seen: dict[str, object] = {}

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                seen["client_kwargs"] = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

            async def request(
                self,
                method: str,
                url: str,
                content: bytes = b"",
                headers: dict[str, str] | None = None,
            ):
                seen["method"] = method
                seen["url"] = url
                seen["content"] = content
                seen["headers"] = headers
                return FakeUpstreamResponse(
                    status_code=303,
                    headers=[
                        ("location", "http://keycloak:8080/realms/zonix/after-login"),
                        ("set-cookie", "AUTH_SESSION_ID=abc; Path=/; HttpOnly"),
                        ("set-cookie", "KC_RESTART=def; Path=/; HttpOnly"),
                        ("content-type", "text/html; charset=utf-8"),
                    ],
                )

        with patch.object(gateway.httpx, "AsyncClient", FakeAsyncClient):
            client = TestClient(gateway.app)
            response = client.get(
                "/realms/zonix/protocol/openid-connect/auth?scope=openid+groups",
                follow_redirects=False,
            )

        self.assertEqual(response.status_code, 303)
        self.assertEqual(
            seen["url"],
            "http://keycloak:8080/realms/zonix/protocol/openid-connect/auth?scope=openid+groups",
        )
        self.assertEqual(seen["method"], "GET")
        self.assertEqual(seen["headers"]["Host"], "localhost:9010")
        self.assertEqual(seen["headers"]["X-Forwarded-Host"], "localhost:9010")
        self.assertEqual(seen["headers"]["X-Forwarded-Proto"], "http")
        self.assertEqual(
            response.headers["location"],
            "http://localhost:9010/realms/zonix/after-login",
        )
        self.assertEqual(
            response.headers.get_list("set-cookie"),
            [
                "AUTH_SESSION_ID=abc; Path=/; HttpOnly",
                "KC_RESTART=def; Path=/; HttpOnly",
            ],
        )

    def test_proxy_forwards_post_body_without_leaking_original_host_header(self) -> None:
        gateway = load_gateway_module()
        seen: dict[str, object] = {}

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs) -> None:
                return None

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb) -> None:
                return None

            async def request(
                self,
                method: str,
                url: str,
                content: bytes = b"",
                headers: dict[str, str] | None = None,
            ):
                seen["method"] = method
                seen["url"] = url
                seen["content"] = content
                seen["headers"] = headers
                return FakeUpstreamResponse(
                    status_code=200,
                    headers=[("content-type", "application/json")],
                    content=b'{"ok":true}',
                )

        with patch.object(gateway.httpx, "AsyncClient", FakeAsyncClient):
            client = TestClient(gateway.app)
            response = client.post(
                "/realms/zonix/protocol/openid-connect/token",
                data={"grant_type": "authorization_code", "code": "test-code"},
                headers={"Host": "evil.example"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertEqual(seen["method"], "POST")
        self.assertEqual(
            seen["url"],
            "http://keycloak:8080/realms/zonix/protocol/openid-connect/token",
        )
        self.assertEqual(
            seen["content"],
            b"grant_type=authorization_code&code=test-code",
        )
        self.assertEqual(seen["headers"]["Host"], "localhost:9010")
        self.assertNotIn("evil.example", seen["headers"].values())


if __name__ == "__main__":
    unittest.main()
