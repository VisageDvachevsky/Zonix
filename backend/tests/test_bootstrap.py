import unittest
from dataclasses import replace
from unittest.mock import patch

from app.bootstrap import (
    ensure_bootstrap_admin,
    ensure_bootstrap_oidc_provider,
    ensure_bootstrap_users,
    settings,
)
from app.domain.models import IdentityProvider, IdentityProviderKind
from app.security import verify_password


class InMemoryBootstrapConnection:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, object]] = {}
        self.identity_providers: dict[str, dict[str, object]] = {}
        self.committed = False

    def __enter__(self) -> InMemoryBootstrapConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> InMemoryBootstrapCursor:
        return InMemoryBootstrapCursor(self)

    def commit(self) -> None:
        self.committed = True


class InMemoryBootstrapCursor:
    def __init__(self, connection: InMemoryBootstrapConnection) -> None:
        self.connection = connection
        self._selected_user: tuple[str] | None = None

    def __enter__(self) -> InMemoryBootstrapCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params: tuple[str, ...]) -> None:
        normalized = " ".join(query.split())
        if normalized.startswith("SELECT username FROM users WHERE username = %s"):
            username = params[0]
            self._selected_user = (username,) if username in self.connection.users else None
            return

        if normalized.startswith("INSERT INTO users"):
            if len(params) == 2:
                username, password_hash = params
                self.connection.users[username] = {
                    "username": username,
                    "password_hash": password_hash,
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                }
                return

            username, password_hash, role, auth_source, is_active = params
            self.connection.users[username] = {
                "username": username,
                "password_hash": password_hash,
                "role": role,
                "auth_source": auth_source,
                "is_active": is_active,
            }
            return

        if normalized.startswith("INSERT INTO identity_providers"):
            (
                name,
                kind,
                issuer,
                client_id,
                client_secret,
                scopes,
                claims_mapping_rules,
            ) = params
            self.connection.identity_providers[name] = {
                "name": name,
                "kind": kind,
                "issuer": issuer,
                "client_id": client_id,
                "client_secret": client_secret,
                "scopes": list(scopes),
                "claims_mapping_rules": __import__("json").loads(str(claims_mapping_rules)),
            }
            return

        raise AssertionError(f"unexpected query: {normalized}")

    def fetchone(self) -> tuple[str] | None:
        return self._selected_user


class BootstrapAdminTests(unittest.TestCase):
    def test_ensure_bootstrap_admin_creates_admin_once(self) -> None:
        connection = InMemoryBootstrapConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryBootstrapConnection:
            return connection

        created = ensure_bootstrap_admin(
            username="admin",
            password="admin",
            connect_fn=connect_stub,
        )

        self.assertTrue(created)
        self.assertTrue(connection.committed)
        self.assertIn("admin", connection.users)
        self.assertTrue(verify_password("admin", connection.users["admin"]["password_hash"]))

        created_again = ensure_bootstrap_admin(
            username="admin",
            password="admin",
            connect_fn=connect_stub,
        )
        self.assertFalse(created_again)

    def test_ensure_bootstrap_admin_respects_disabled_bootstrap_flag(self) -> None:
        connection = InMemoryBootstrapConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryBootstrapConnection:
            return connection

        with patch("app.bootstrap.settings", replace(settings, bootstrap_admin_enabled=False)):
            created = ensure_bootstrap_admin(
                username="admin",
                password="admin",
                connect_fn=connect_stub,
            )

        self.assertFalse(created)
        self.assertEqual(connection.users, {})

    def test_ensure_bootstrap_oidc_provider_upserts_provider_configuration(self) -> None:
        connection = InMemoryBootstrapConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryBootstrapConnection:
            return connection

        created = ensure_bootstrap_oidc_provider(
            provider=IdentityProvider(
                name="corp-oidc",
                kind=IdentityProviderKind.OIDC,
                issuer="https://issuer.example",
                clientId="zonix-ui",
                clientSecret="super-secret",
                scopes=("openid", "profile", "email"),
                claimsMappingRules={
                    "rolesClaim": "groups",
                    "adminGroups": ["dns-admins"],
                },
            ),
            connect_fn=connect_stub,
        )

        self.assertTrue(created)
        self.assertTrue(connection.committed)
        self.assertIn("corp-oidc", connection.identity_providers)
        self.assertEqual(connection.identity_providers["corp-oidc"]["client_id"], "zonix-ui")

    def test_ensure_bootstrap_users_upserts_local_and_oidc_accounts(self) -> None:
        connection = InMemoryBootstrapConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryBootstrapConnection:
            return connection

        count = ensure_bootstrap_users(
            users=(
                {
                    "username": "alice",
                    "password": "editor",
                    "role": "editor",
                    "authSource": "local",
                },
                {
                    "username": "oidc.viewer",
                    "role": "viewer",
                    "authSource": "oidc:corp-oidc",
                },
            ),
            connect_fn=connect_stub,
        )

        self.assertEqual(count, 2)
        self.assertTrue(connection.committed)
        self.assertTrue(verify_password("editor", connection.users["alice"]["password_hash"]))
        self.assertEqual(connection.users["alice"]["role"], "editor")
        self.assertEqual(connection.users["oidc.viewer"]["password_hash"], "")
        self.assertEqual(connection.users["oidc.viewer"]["auth_source"], "oidc:corp-oidc")


if __name__ == "__main__":
    unittest.main()
