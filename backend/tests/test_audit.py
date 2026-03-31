from __future__ import annotations

import unittest
from datetime import UTC, datetime

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.audit import AuditService, DatabaseAuditEventRepository, InMemoryAuditEventRepository
from app.domain.models import AuditEvent, Backend, BackendCapability, Role, User, Zone, ZoneAction


class InMemoryAuditConnection:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []
        self.commit_count = 0

    def __enter__(self) -> InMemoryAuditConnection:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> InMemoryAuditCursor:
        return InMemoryAuditCursor(self)

    def commit(self) -> None:
        self.commit_count += 1


class InMemoryAuditCursor:
    def __init__(self, connection: InMemoryAuditConnection) -> None:
        self.connection = connection
        self._rows: list[tuple[object, ...]] = []

    def __enter__(self) -> InMemoryAuditCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
        normalized = " ".join(query.split())
        arguments = params or ()

        if normalized.startswith("INSERT INTO audit_events"):
            actor, action, zone_name, backend_name, payload, created_at = arguments
            self.connection.events.append(
                {
                    "actor": actor,
                    "action": action,
                    "zone_name": zone_name,
                    "backend_name": backend_name,
                    "payload": __import__("json").loads(str(payload)),
                    "created_at": created_at,
                }
            )
            return

        if normalized.startswith(
            "SELECT actor, action, zone_name, backend_name, payload, created_at FROM audit_events"
        ):
            ordered = sorted(
                self.connection.events,
                key=lambda item: item["created_at"],
                reverse=True,
            )

            if "WHERE actor = %s OR zone_name = ANY(%s)" in normalized:
                actor = str(arguments[0])
                zone_names = {str(item) for item in arguments[1]}
                limit = int(arguments[2])
                ordered = [
                    item
                    for item in ordered
                    if item["actor"] == actor
                    or (
                        item["zone_name"] is not None
                        and str(item["zone_name"]) in zone_names
                    )
                ][:limit]
            elif "WHERE actor = %s" in normalized:
                actor = str(arguments[0])
                limit = int(arguments[1])
                ordered = [item for item in ordered if item["actor"] == actor][:limit]
            else:
                limit = int(arguments[0])
                ordered = ordered[:limit]

            self._rows = [
                (
                    item["actor"],
                    item["action"],
                    item["zone_name"],
                    item["backend_name"],
                    item["payload"],
                    item["created_at"],
                )
                for item in ordered
            ]
            return

        raise AssertionError(f"unexpected query: {normalized}")

    def fetchall(self) -> list[tuple[object, ...]]:
        return list(self._rows)


class AuditServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        access_service = AccessService(
            user_repository=InMemoryUserDirectory(
                users={
                    "admin": User(username="admin", role=Role.ADMIN),
                    "alice": User(username="alice", role=Role.EDITOR),
                    "bob": User(username="bob", role=Role.VIEWER),
                }
            ),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        access_service.register_backend(
            Backend(
                name="powerdns-local",
                backend_type="powerdns",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.WRITE_RECORDS),
            )
        )
        access_service.register_zone(Zone(name="example.com", backend_name="powerdns-local"))
        access_service.register_zone(Zone(name="lab.example", backend_name="powerdns-local"))
        access_service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE,),
        )
        access_service.assign_zone_grant(
            username="bob",
            zone_name="lab.example",
            actions=(ZoneAction.READ,),
        )

        self.service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )

    def test_non_admin_only_sees_own_login_and_accessible_zone_events(self) -> None:
        self.service.log_event(actor="alice", action="login.success", payload={"role": "editor"})
        self.service.log_event(
            actor="alice",
            action="record.created",
            zone_name="example.com",
            backend_name="powerdns-local",
        )
        self.service.log_event(
            actor="admin",
            action="record.deleted",
            zone_name="lab.example",
            backend_name="powerdns-local",
        )

        events = self.service.list_events_for_user(User(username="alice", role=Role.EDITOR))

        self.assertEqual(
            [event.action for event in events],
            ["record.created", "login.success"],
        )


class DatabaseAuditEventRepositoryTests(unittest.TestCase):
    def test_repository_round_trips_payload_and_created_at(self) -> None:
        connection = InMemoryAuditConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryAuditConnection:
            return connection

        repository = DatabaseAuditEventRepository("postgresql://test", connect_fn=connect_stub)
        created_at = datetime(2026, 3, 27, 12, 0, tzinfo=UTC)

        repository.add(
            AuditEvent(
                actor="alice",
                action="record.created",
                zone_name="example.com",
                backend_name="powerdns-local",
                payload={"name": "www", "recordType": "A"},
                created_at=created_at,
            )
        )

        events = repository.list_recent(limit=10)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].payload["recordType"], "A")
        self.assertEqual(events[0].created_at, created_at)
        self.assertEqual(connection.commit_count, 1)

    def test_repository_filters_visible_events_by_actor_or_zone(self) -> None:
        connection = InMemoryAuditConnection()

        def connect_stub(_database_url: str | None = None) -> InMemoryAuditConnection:
            return connection

        repository = DatabaseAuditEventRepository("postgresql://test", connect_fn=connect_stub)
        repository.add(
            AuditEvent(
                actor="admin",
                action="record.updated",
                zone_name="lab.example",
                backend_name="bind-lab",
                created_at=datetime(2026, 3, 27, 12, 0, tzinfo=UTC),
            )
        )
        repository.add(
            AuditEvent(
                actor="alice",
                action="login.success",
                created_at=datetime(2026, 3, 27, 12, 5, tzinfo=UTC),
            )
        )
        repository.add(
            AuditEvent(
                actor="carol",
                action="record.deleted",
                zone_name="secret.example",
                backend_name="powerdns-local",
                created_at=datetime(2026, 3, 27, 12, 10, tzinfo=UTC),
            )
        )

        events = repository.list_visible_for_user(
            username="alice",
            zone_names=("lab.example",),
            limit=10,
        )

        self.assertEqual([event.action for event in events], ["login.success", "record.updated"])


if __name__ == "__main__":
    unittest.main()
