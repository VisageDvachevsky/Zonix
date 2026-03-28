from __future__ import annotations

import unittest

from app.domain.models import IdentityProvider, IdentityProviderKind
from app.identity_providers import (
    DatabaseIdentityProviderRepository,
    IdentityProviderService,
    InMemoryIdentityProviderRepository,
)
from app.oidc import OIDCIdentity, OIDCService, OIDCStateManager


class InMemoryIdentityProviderRepositoryTests(unittest.TestCase):
    def test_service_registers_and_lists_identity_providers(self) -> None:
        service = IdentityProviderService(InMemoryIdentityProviderRepository())
        provider = IdentityProvider(
            name="corp-oidc",
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid", "profile", "email"),
            claimsMappingRules={"rolesClaim": "groups"},
        )

        service.register_provider(provider)

        self.assertEqual(service.get_provider("corp-oidc"), provider)
        self.assertEqual(service.list_providers(), (provider,))


class InMemoryIdentityProviderConnection:
    def __init__(self) -> None:
        self.providers: list[dict[str, object]] = []
        self.commit_count = 0

    def __enter__(self) -> InMemoryIdentityProviderConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> InMemoryIdentityProviderCursor:
        return InMemoryIdentityProviderCursor(self)

    def commit(self) -> None:
        self.commit_count += 1


class InMemoryIdentityProviderCursor:
    def __init__(self, connection: InMemoryIdentityProviderConnection) -> None:
        self.connection = connection
        self._rows: list[tuple[object, ...]] = []

    def __enter__(self) -> InMemoryIdentityProviderCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
        normalized = " ".join(query.split())
        arguments = params or ()

        if normalized.startswith("INSERT INTO identity_providers"):
            (
                name,
                kind,
                issuer,
                client_id,
                client_secret,
                scopes,
                claims_mapping_rules,
            ) = arguments
            provider = {
                "name": name,
                "kind": kind,
                "issuer": issuer,
                "client_id": client_id,
                "client_secret": client_secret,
                "scopes": list(scopes),
                "claims_mapping_rules": __import__("json").loads(str(claims_mapping_rules)),
            }
            self.connection.providers = [
                item for item in self.connection.providers if item["name"] != name
            ]
            self.connection.providers.append(provider)
            return

        if normalized.startswith("SELECT name, kind, issuer, client_id, client_secret, scopes, claims_mapping_rules FROM identity_providers WHERE name = %s"):
            name = str(arguments[0])
            matches = [item for item in self.connection.providers if item["name"] == name]
            self._rows = [
                (
                    item["name"],
                    item["kind"],
                    item["issuer"],
                    item["client_id"],
                    item["client_secret"],
                    item["scopes"],
                    item["claims_mapping_rules"],
                )
                for item in matches
            ]
            return

        if normalized.startswith("SELECT name, kind, issuer, client_id, client_secret, scopes, claims_mapping_rules FROM identity_providers ORDER BY name"):
            ordered = sorted(self.connection.providers, key=lambda item: str(item["name"]))
            self._rows = [
                (
                    item["name"],
                    item["kind"],
                    item["issuer"],
                    item["client_id"],
                    item["client_secret"],
                    item["scopes"],
                    item["claims_mapping_rules"],
                )
                for item in ordered
            ]
            return

        raise AssertionError(f"unexpected query: {normalized}")

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self._rows)

    def fetchone(self) -> tuple[object, ...] | None:
        return None if not self._rows else self._rows[0]


class DatabaseIdentityProviderRepositoryTests(unittest.TestCase):
    def test_repository_round_trips_oidc_configuration(self) -> None:
        connection = InMemoryIdentityProviderConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryIdentityProviderConnection:
            return connection

        repository = DatabaseIdentityProviderRepository(
            "postgresql://test",
            connect_fn=connect_stub,
        )
        provider = IdentityProvider(
            name="corp-oidc",
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid", "profile"),
            claimsMappingRules={
                "rolesClaim": "groups",
                "zoneViewerPattern": "zone-{zone}-viewers",
            },
        )

        repository.add(provider)

        self.assertEqual(repository.get_by_name("corp-oidc"), provider)
        self.assertEqual(repository.list_all(), (provider,))
        self.assertEqual(connection.commit_count, 1)


class OIDCMappingTests(unittest.TestCase):
    def test_mapping_promotes_zone_editor_group_into_editor_and_write_grant(self) -> None:
        provider = IdentityProvider(
            name="corp-oidc",
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid", "profile"),
            claimsMappingRules={
                "usernameClaim": "preferred_username",
                "rolesClaim": "groups",
                "zoneEditorPattern": "zone-{zone}-editors",
                "zoneViewerPattern": "zone-{zone}-viewers",
            },
        )
        service = OIDCService(
            identity_provider_service=IdentityProviderService(
                InMemoryIdentityProviderRepository({"corp-oidc": provider})
            ),
            state_manager=OIDCStateManager(secret_key="test-secret"),
        )

        mapping = service.map_identity(
            provider_name="corp-oidc",
            identity=OIDCIdentity(
                username="oidc.alice",
                claims={
                    "preferred_username": "oidc.alice",
                    "groups": ["zone-example.com-editors"],
                },
            ),
            known_zones=("example.com", "internal.example"),
        )

        self.assertEqual(mapping.role.value, "editor")
        self.assertEqual(len(mapping.grants), 1)
        self.assertEqual(mapping.grants[0].zone_name, "example.com")
        self.assertEqual(
            [action.value for action in mapping.grants[0].actions],
            ["write"],
        )

    def test_mapping_promotes_admin_group_into_admin_without_zone_grants(self) -> None:
        provider = IdentityProvider(
            name="corp-oidc",
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid",),
            claimsMappingRules={
                "rolesClaim": "groups",
                "adminGroups": ["dns-admins"],
                "zoneEditorPattern": "zone-{zone}-editors",
            },
        )
        service = OIDCService(
            identity_provider_service=IdentityProviderService(
                InMemoryIdentityProviderRepository({"corp-oidc": provider})
            ),
            state_manager=OIDCStateManager(secret_key="test-secret"),
        )

        mapping = service.map_identity(
            provider_name="corp-oidc",
            identity=OIDCIdentity(
                username="oidc.admin",
                claims={"groups": ["dns-admins", "zone-example.com-editors"]},
            ),
            known_zones=("example.com",),
        )

        self.assertEqual(mapping.role.value, "admin")
        self.assertEqual(mapping.grants, ())


if __name__ == "__main__":
    unittest.main()
