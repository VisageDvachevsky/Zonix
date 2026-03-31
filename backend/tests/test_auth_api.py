import unittest
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryZoneRepository,
)
from app.audit import AuditService, InMemoryAuditEventRepository
from app.auth import AuthService, InMemoryUserRepository, SessionManager
from app.domain.models import (
    Backend,
    IdentityProvider,
    IdentityProviderKind,
    User,
    Zone,
)
from app.identity_providers import IdentityProviderService, InMemoryIdentityProviderRepository
from app.main import create_app
from app.oidc import OIDCClient, OIDCService, OIDCStateManager
from app.security import hash_password
from app.zone_reads import ZoneReadService


class InMemoryZoneReadAdapter:
    def list_zones(self) -> tuple[Zone, ...]:
        return (Zone(name="example.com", backend_name="powerdns-local"),)

    def get_zone(self, zone_name: str) -> Zone | None:
        if zone_name == "example.com":
            return Zone(name="example.com", backend_name="powerdns-local")
        return None

    def list_records(self, zone_name: str) -> tuple[object, ...]:
        if zone_name == "example.com":
            return ()
        return ()


class SharedUserDirectory:
    def __init__(self, repository: InMemoryUserRepository) -> None:
        self.repository = repository

    def get_by_username(self, username: str) -> User | None:
        record = self.repository.get_by_username(username)
        return None if record is None or not record.is_active else record.to_user()


class FakeOIDCClient(OIDCClient):
    def fetch_json(self, url: str, headers: dict[str, str] | None = None) -> dict[str, object]:
        if url.endswith("/.well-known/openid-configuration"):
            return {
                "authorization_endpoint": "https://issuer.example/authorize",
                "token_endpoint": "https://issuer.example/token",
                "userinfo_endpoint": "https://issuer.example/userinfo",
            }
        if url == "https://issuer.example/userinfo":
            if headers != {"Authorization": "Bearer oidc-access-token"}:
                raise AssertionError(f"unexpected userinfo headers: {headers}")
            return {
                "sub": "oidc-user-123",
                "preferred_username": "oidc.alice",
                "email": "oidc.alice@example.com",
                "groups": ["zone-example.com-editors"],
            }
        raise AssertionError(f"unexpected fetch_json url: {url}")

    def post_form(self, url: str, data: dict[str, str]) -> dict[str, object]:
        if url != "https://issuer.example/token":
            raise AssertionError(f"unexpected token url: {url}")
        if data["grant_type"] != "authorization_code":
            raise AssertionError(f"unexpected grant type: {data['grant_type']}")
        if data["code"] != "test-code":
            raise AssertionError(f"unexpected code: {data['code']}")
        return {"access_token": "oidc-access-token"}


class AuthApiTests(unittest.TestCase):
    def setUp(self) -> None:
        repository = InMemoryUserRepository(
            {
                "admin": {
                    "username": "admin",
                    "password_hash": hash_password("admin"),
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                }
            }
        )
        auth_service = AuthService(
            user_repository=repository,
            session_manager=SessionManager(secret_key="test-secret"),
            allow_oidc_self_signup=True,
        )
        identity_provider_service = IdentityProviderService(
            InMemoryIdentityProviderRepository(
                {
                    "corp-oidc": IdentityProvider(
                        name="corp-oidc",
                        kind=IdentityProviderKind.OIDC,
                        issuer="https://issuer.example",
                        clientId="zonix-ui",
                        clientSecret="super-secret",
                        scopes=("openid", "profile", "email"),
                        claimsMappingRules={
                            "usernameClaim": "preferred_username",
                            "rolesClaim": "groups",
                            "zoneEditorPattern": "zone-{zone}-editors",
                            "zoneViewerPattern": "zone-{zone}-viewers",
                        },
                    )
                }
            )
        )
        oidc_service = OIDCService(
            identity_provider_service=identity_provider_service,
            state_manager=OIDCStateManager(secret_key="test-secret"),
            client=FakeOIDCClient(),
        )
        access_service = AccessService(
            user_repository=SharedUserDirectory(repository),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        access_service.register_backend(
            Backend(name="powerdns-local", backend_type="powerdns", capabilities=())
        )
        access_service.register_zone(Zone(name="example.com", backend_name="powerdns-local"))
        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={"powerdns-local": InMemoryZoneReadAdapter()},
        )
        audit_service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )
        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                identity_provider_service=identity_provider_service,
                zone_read_service=zone_read_service,
                audit_service=audit_service,
                oidc_service=oidc_service,
            )
        )

    def csrf_headers(self) -> dict[str, str]:
        token = self.client.cookies.get("zonix_csrf_token")
        return {} if token is None else {"X-CSRF-Token": token}

    def test_login_sets_session_cookie_and_returns_authenticated_user(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "admin")
        self.assertIn("zonix_session", response.cookies)
        self.assertIn("zonix_csrf_token", response.cookies)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=lax", response.headers["set-cookie"])
        self.assertIn("Max-Age=43200", response.headers["set-cookie"])

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["authenticated"], True)
        self.assertEqual(me_response.json()["user"]["role"], "admin")

        audit_response = self.client.get("/audit")
        self.assertEqual(audit_response.status_code, 200)
        self.assertEqual(audit_response.json()["items"][0]["action"], "login.success")
        self.assertEqual(audit_response.json()["items"][0]["actor"], "admin")

    def test_login_rejects_invalid_credentials(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "wrong"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "invalid credentials")
        self.assertNotIn("zonix_session", response.cookies)

        login_audit = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        self.assertEqual(login_audit.status_code, 200)
        audit_response = self.client.get("/audit")
        actions = [item["action"] for item in audit_response.json()["items"]]
        self.assertIn("login.failed", actions)

    def test_login_rate_limit_returns_429_after_repeated_failures(self) -> None:
        for _ in range(5):
            response = self.client.post(
                "/auth/login",
                json={"username": "admin", "password": "wrong"},
            )
            self.assertEqual(response.status_code, 401)

        throttled_response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "wrong"},
        )

        self.assertEqual(throttled_response.status_code, 429)
        self.assertEqual(throttled_response.json()["detail"], "too many login attempts")
        self.assertIn("Retry-After", throttled_response.headers)

    def test_request_body_limit_rejects_oversized_login_payload(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "x" * 70000},
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            response.json()["detail"],
            "request body exceeds configured size limit",
        )

    def test_logout_clears_session_cookie(self) -> None:
        self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )

        response = self.client.post("/auth/logout", headers=self.csrf_headers())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["authenticated"], False)
        self.assertIn('zonix_session="";', response.headers["set-cookie"])

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 401)
        self.assertEqual(me_response.json()["detail"], "not authenticated")

        self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        self.client.post("/auth/logout", headers=self.csrf_headers())
        self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        audit_response = self.client.get("/audit")
        self.assertIn("logout.success", [item["action"] for item in audit_response.json()["items"]])

    def test_me_requires_valid_session(self) -> None:
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "not authenticated")

    def test_me_rejects_malformed_session_cookie(self) -> None:
        self.client.cookies.set("zonix_session", "not-a-valid-session")

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "not authenticated")

    def test_oidc_login_start_lists_provider_and_returns_authorization_url(self) -> None:
        list_response = self.client.get("/auth/oidc/providers")
        start_response = self.client.get("/auth/oidc/corp-oidc/login")

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["items"], [{"name": "corp-oidc", "kind": "oidc"}])
        self.assertEqual(start_response.status_code, 200)
        self.assertEqual(start_response.json()["providerName"], "corp-oidc")
        self.assertIn(
            "https://issuer.example/authorize?", start_response.json()["authorizationUrl"]
        )

    def test_oidc_callback_maps_groups_into_role_and_zone_access(self) -> None:
        start_response = self.client.get("/auth/oidc/corp-oidc/login")
        authorization_url = start_response.json()["authorizationUrl"]
        state = parse_qs(urlparse(authorization_url).query)["state"][0]

        callback_response = self.client.get(
            f"/auth/oidc/corp-oidc/callback?code=test-code&state={state}"
        )

        self.assertEqual(callback_response.status_code, 200)
        self.assertTrue(callback_response.json()["authenticated"])
        self.assertEqual(callback_response.json()["user"]["username"], "oidc.alice")
        self.assertEqual(callback_response.json()["user"]["role"], "editor")
        self.assertIn("zonix_session", callback_response.cookies)
        self.assertIn("zonix_csrf_token", callback_response.cookies)

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["user"]["username"], "oidc.alice")
        self.assertEqual(me_response.json()["user"]["role"], "editor")

        zones_response = self.client.get("/zones")
        self.assertEqual(zones_response.status_code, 200)
        self.assertEqual(
            zones_response.json()["items"],
            [{"name": "example.com", "backendName": "powerdns-local"}],
        )

        audit_response = self.client.get("/audit")
        self.assertEqual(audit_response.status_code, 200)
        self.assertEqual(audit_response.json()["items"][0]["actor"], "oidc.alice")
        self.assertEqual(
            audit_response.json()["items"][0]["payload"]["authSource"], "oidc:corp-oidc"
        )

    def test_oidc_callback_redirects_to_frontend_when_return_to_is_requested(self) -> None:
        start_response = self.client.get(
            "/auth/oidc/corp-oidc/login",
            params={"return_to": "http://localhost:5173"},
        )
        authorization_url = start_response.json()["authorizationUrl"]
        state = parse_qs(urlparse(authorization_url).query)["state"][0]

        callback_response = self.client.get(
            f"/auth/oidc/corp-oidc/callback?code=test-code&state={state}",
            follow_redirects=False,
        )

        self.assertEqual(callback_response.status_code, 303)
        self.assertEqual(callback_response.headers["location"], "http://localhost:5173")
        self.assertIn("zonix_session", callback_response.cookies)
        self.assertIn("zonix_csrf_token", callback_response.cookies)

    def test_oidc_login_start_rejects_untrusted_return_to_origin(self) -> None:
        response = self.client.get(
            "/auth/oidc/corp-oidc/login",
            params={"return_to": "https://evil.example/steal"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "return_to origin is not allowed")

    def test_oidc_callback_rejects_invalid_state(self) -> None:
        response = self.client.get("/auth/oidc/corp-oidc/callback?code=test-code&state=broken")

        self.assertEqual(response.status_code, 400)
        self.assertIn("oidc state", response.json()["detail"])

    def test_oidc_callback_rejects_unprovisioned_user_when_self_signup_disabled(self) -> None:
        repository = InMemoryUserRepository(
            {
                "admin": {
                    "username": "admin",
                    "password_hash": hash_password("admin"),
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                }
            }
        )
        auth_service = AuthService(
            user_repository=repository,
            session_manager=SessionManager(secret_key="test-secret"),
            allow_oidc_self_signup=False,
        )
        access_service = AccessService(
            user_repository=SharedUserDirectory(repository),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        access_service.register_backend(
            Backend(name="powerdns-local", backend_type="powerdns", capabilities=())
        )
        access_service.register_zone(Zone(name="example.com", backend_name="powerdns-local"))
        client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                identity_provider_service=self.client.app.state.identity_provider_service,
                zone_read_service=ZoneReadService(
                    access_service=access_service,
                    adapters={"powerdns-local": InMemoryZoneReadAdapter()},
                ),
                audit_service=AuditService(
                    repository=InMemoryAuditEventRepository(),
                    access_service=access_service,
                ),
                oidc_service=self.client.app.state.oidc_service,
            )
        )

        start_response = client.get("/auth/oidc/corp-oidc/login")
        authorization_url = start_response.json()["authorizationUrl"]
        state = parse_qs(urlparse(authorization_url).query)["state"][0]

        response = client.get(f"/auth/oidc/corp-oidc/callback?code=test-code&state={state}")

        self.assertEqual(response.status_code, 403)
        self.assertIn("self-signup is disabled", response.json()["detail"])

    def test_logout_rejects_missing_csrf_token(self) -> None:
        self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "csrf token invalid or missing")

    def test_auth_settings_reports_hardening_configuration(self) -> None:
        response = self.client.get("/auth/settings")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["localLoginEnabled"])
        self.assertTrue(payload["csrfEnabled"])
        self.assertEqual(payload["sessionCookieName"], "zonix_session")


if __name__ == "__main__":
    unittest.main()
