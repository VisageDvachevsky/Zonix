from __future__ import annotations

import unittest

from app.access import (
    DatabaseBackendRepository,
    DatabasePermissionGrantRepository,
    DatabaseZoneRepository,
)
from app.domain.models import Backend, BackendCapability, PermissionGrant, Zone, ZoneAction


class InMemoryAccessConnection:
    def __init__(self) -> None:
        self.backends: dict[str, dict[str, object]] = {}
        self.zones: dict[str, dict[str, str]] = {}
        self.permission_grants: dict[tuple[str, str], dict[str, object]] = {}
        self.commit_count = 0

    def __enter__(self) -> InMemoryAccessConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> InMemoryAccessCursor:
        return InMemoryAccessCursor(self)

    def commit(self) -> None:
        self.commit_count += 1


class InMemoryAccessCursor:
    def __init__(self, connection: InMemoryAccessConnection) -> None:
        self.connection = connection
        self._rows: list[tuple[object, ...]] = []

    def __enter__(self) -> InMemoryAccessCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
        normalized = " ".join(query.split())
        arguments = params or ()

        if normalized.startswith("INSERT INTO backends"):
            name, backend_type, capabilities = arguments
            self.connection.backends[str(name)] = {
                "name": str(name),
                "backend_type": str(backend_type),
                "capabilities": list(capabilities),
            }
            return

        if normalized.startswith(
            "SELECT name, backend_type, capabilities FROM backends WHERE name = %s"
        ):
            name = str(arguments[0])
            backend = self.connection.backends.get(name)
            self._rows = (
                []
                if backend is None
                else [(backend["name"], backend["backend_type"], backend["capabilities"])]
            )
            return

        if normalized.startswith(
            "SELECT name, backend_type, capabilities FROM backends ORDER BY name"
        ):
            self._rows = [
                (backend["name"], backend["backend_type"], backend["capabilities"])
                for backend in sorted(
                    self.connection.backends.values(),
                    key=lambda item: item["name"],
                )
            ]
            return

        if normalized.startswith("INSERT INTO zones"):
            name, backend_name = arguments
            self.connection.zones[str(name)] = {
                "name": str(name),
                "backend_name": str(backend_name),
            }
            return

        if normalized.startswith(
            "DELETE FROM zones WHERE backend_name = %s AND NOT (name = ANY(%s))"
        ):
            backend_name = str(arguments[0])
            retained_names = {str(item) for item in arguments[1]}
            self.connection.zones = {
                name: zone
                for name, zone in self.connection.zones.items()
                if zone["backend_name"] != backend_name or name in retained_names
            }
            return

        if normalized.startswith("DELETE FROM zones WHERE backend_name = %s"):
            backend_name = str(arguments[0])
            self.connection.zones = {
                name: zone
                for name, zone in self.connection.zones.items()
                if zone["backend_name"] != backend_name
            }
            return

        if normalized.startswith("SELECT name, backend_name FROM zones WHERE name = %s"):
            name = str(arguments[0])
            zone = self.connection.zones.get(name)
            self._rows = [] if zone is None else [(zone["name"], zone["backend_name"])]
            return

        if normalized.startswith("SELECT name, backend_name FROM zones ORDER BY name"):
            self._rows = [
                (zone["name"], zone["backend_name"])
                for zone in sorted(self.connection.zones.values(), key=lambda item: item["name"])
            ]
            return

        if normalized.startswith("INSERT INTO permission_grants"):
            username, zone_name, actions = arguments
            self.connection.permission_grants[(str(username), str(zone_name))] = {
                "username": str(username),
                "zone_name": str(zone_name),
                "actions": list(actions),
            }
            return

        if normalized.startswith(
            "SELECT username, zone_name, actions FROM permission_grants "
            "WHERE username = %s ORDER BY zone_name"
        ):
            username = str(arguments[0])
            self._rows = [
                (grant["username"], grant["zone_name"], grant["actions"])
                for grant in sorted(
                    self.connection.permission_grants.values(),
                    key=lambda item: item["zone_name"],
                )
                if grant["username"] == username
            ]
            return

        raise AssertionError(f"unexpected query: {normalized}")

    def fetchone(self) -> tuple[object, ...] | None:
        return None if not self._rows else self._rows[0]

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self._rows)


class DatabaseAccessRepositoriesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = InMemoryAccessConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryAccessConnection:
            return self.connection

        self.backends = DatabaseBackendRepository("postgresql://test", connect_fn=connect_stub)
        self.zones = DatabaseZoneRepository("postgresql://test", connect_fn=connect_stub)
        self.grants = DatabasePermissionGrantRepository(
            "postgresql://test",
            connect_fn=connect_stub,
        )

    def test_backend_repository_upserts_and_reads_capabilities(self) -> None:
        self.backends.add(
            Backend(
                name="powerdns-local",
                backend_type="powerdns",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.READ_RECORDS),
            )
        )
        self.backends.add(
            Backend(
                name="powerdns-local",
                backend_type="powerdns",
                capabilities=(BackendCapability.READ_ZONES,),
            )
        )

        backend = self.backends.get_by_name("powerdns-local")
        listed = self.backends.list_all()

        self.assertIsNotNone(backend)
        assert backend is not None
        self.assertEqual(backend.capabilities, (BackendCapability.READ_ZONES,))
        self.assertEqual([item.name for item in listed], ["powerdns-local"])
        self.assertGreaterEqual(self.connection.commit_count, 2)

    def test_zone_repository_replace_for_backend_prunes_stale_zones(self) -> None:
        self.zones.add(Zone(name="old.example", backend_name="powerdns-local"))
        self.zones.add(Zone(name="bind.example", backend_name="bind-lab"))

        synchronized = self.zones.replace_for_backend(
            "powerdns-local",
            (
                Zone(name="example.com", backend_name="powerdns-local"),
                Zone(name="internal.example", backend_name="powerdns-local"),
            ),
        )

        self.assertEqual([zone.name for zone in synchronized], ["example.com", "internal.example"])
        self.assertEqual(
            [zone.name for zone in self.zones.list_all()],
            ["bind.example", "example.com", "internal.example"],
        )
        self.assertIsNone(self.zones.get_by_name("old.example"))

    def test_permission_grants_round_trip_normalized_actions(self) -> None:
        self.grants.upsert(
            PermissionGrant(
                username="alice",
                zone_name="example.com",
                actions=(ZoneAction.READ, ZoneAction.WRITE),
            )
        )

        grants = self.grants.list_for_user("alice")

        self.assertEqual(len(grants), 1)
        self.assertEqual(grants[0].actions, (ZoneAction.READ, ZoneAction.WRITE))


if __name__ == "__main__":
    unittest.main()
