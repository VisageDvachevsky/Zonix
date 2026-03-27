import unittest

from fastapi.testclient import TestClient

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.auth import AuthService, InMemoryUserRepository, SessionManager
from app.domain.models import Role, User
from app.main import create_app
from app.security import hash_password
from app.zone_reads import ZoneReadService


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
        )
        access_service = AccessService(
            user_repository=InMemoryUserDirectory(
                users={"admin": User(username="admin", role=Role.ADMIN)}
            ),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        zone_read_service = ZoneReadService(access_service=access_service, adapters={})
        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                zone_read_service=zone_read_service,
            )
        )

    def test_login_sets_session_cookie_and_returns_authenticated_user(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["username"], "admin")
        self.assertIn("zonix_session", response.cookies)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("SameSite=lax", response.headers["set-cookie"])
        self.assertIn("Max-Age=43200", response.headers["set-cookie"])

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["authenticated"], True)
        self.assertEqual(me_response.json()["user"]["role"], "admin")

    def test_login_rejects_invalid_credentials(self) -> None:
        response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "wrong"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "invalid credentials")
        self.assertNotIn("zonix_session", response.cookies)

    def test_logout_clears_session_cookie(self) -> None:
        self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )

        response = self.client.post("/auth/logout")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["authenticated"], False)
        self.assertIn('zonix_session="";', response.headers["set-cookie"])

        me_response = self.client.get("/auth/me")
        self.assertEqual(me_response.status_code, 401)
        self.assertEqual(me_response.json()["detail"], "not authenticated")

    def test_me_requires_valid_session(self) -> None:
        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "not authenticated")

    def test_me_rejects_malformed_session_cookie(self) -> None:
        self.client.cookies.set("zonix_session", "not-a-valid-session")

        response = self.client.get("/auth/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "not authenticated")


if __name__ == "__main__":
    unittest.main()
