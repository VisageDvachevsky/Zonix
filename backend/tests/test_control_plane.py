import unittest

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.audit import AuditService, InMemoryAuditEventRepository
from app.control_plane import BulkRecordChange, ControlPlaneService
from app.domain.models import (
    Backend,
    BackendCapability,
    ChangeOperation,
    RecordSet,
    Role,
    User,
    Zone,
    ZoneAction,
)
from app.record_writes import RecordWriteService
from app.zone_reads import ZoneReadService


class InMemoryZoneAdapter:
    def __init__(
        self,
        zones: tuple[Zone, ...],
        records: dict[str, tuple[RecordSet, ...]],
    ) -> None:
        self.zones = {zone.name: zone for zone in zones}
        self.records = dict(records)

    def list_zones(self) -> tuple[Zone, ...]:
        return tuple(sorted(self.zones.values(), key=lambda zone: zone.name))

    def get_zone(self, zone_name: str) -> Zone | None:
        return self.zones.get(zone_name)

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]:
        return self.records.get(zone_name, ())

    def create_record_set(self, record_set: RecordSet) -> RecordSet:
        existing = list(self.records.get(record_set.zone_name, ()))
        existing.append(record_set)
        self.records[record_set.zone_name] = tuple(
            sorted(existing, key=lambda item: (item.name, item.record_type))
        )
        return record_set

    def update_record_set(self, record_set: RecordSet) -> RecordSet:
        existing = [
            item
            for item in self.records.get(record_set.zone_name, ())
            if not (item.name == record_set.name and item.record_type == record_set.record_type)
        ]
        existing.append(record_set)
        self.records[record_set.zone_name] = tuple(
            sorted(existing, key=lambda item: (item.name, item.record_type))
        )
        return record_set

    def delete_record_set(self, zone_name: str, name: str, record_type: str) -> None:
        self.records[zone_name] = tuple(
            item
            for item in self.records.get(zone_name, ())
            if not (item.name == name and item.record_type == record_type)
        )


class ControlPlaneServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.access_service = AccessService(
            user_repository=InMemoryUserDirectory(
                users={
                    "admin": User(username="admin", role=Role.ADMIN),
                    "alice": User(username="alice", role=Role.EDITOR),
                }
            ),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        self.access_service.register_backend(
            Backend(
                name="bind-lab",
                backend_type="rfc2136-bind",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                ),
            )
        )
        self.access_service.register_backend(
            Backend(
                name="powerdns-sandbox",
                backend_type="powerdns",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                ),
            )
        )
        self.access_service.register_zone(Zone(name="lab.example", backend_name="bind-lab"))
        self.access_service.register_zone(Zone(name="example.com", backend_name="powerdns-sandbox"))
        self.access_service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE,),
        )

        self.bind_adapter = InMemoryZoneAdapter(
            zones=(Zone(name="lab.example", backend_name="bind-lab"),),
            records={
                "lab.example": (
                    RecordSet(
                        zone_name="lab.example",
                        name="@",
                        record_type="TXT",
                        ttl=300,
                        values=('"bind"',),
                    ),
                )
            },
        )
        self.powerdns_adapter = InMemoryZoneAdapter(
            zones=(Zone(name="example.com", backend_name="powerdns-sandbox"),),
            records={
                "example.com": (
                    RecordSet(
                        zone_name="example.com",
                        name="www",
                        record_type="A",
                        ttl=300,
                        values=("192.0.2.10",),
                    ),
                )
            },
        )
        self.zone_read_service = ZoneReadService(
            access_service=self.access_service,
            adapters={
                "bind-lab": self.bind_adapter,
                "powerdns-sandbox": self.powerdns_adapter,
            },
        )
        self.audit_repository = InMemoryAuditEventRepository()
        self.control_plane = ControlPlaneService(
            access_service=self.access_service,
            zone_read_service=self.zone_read_service,
            record_write_service=RecordWriteService(
                access_service=self.access_service,
                zone_read_service=self.zone_read_service,
                adapters=self.zone_read_service.adapters,
            ),
            audit_service=AuditService(
                repository=self.audit_repository,
                access_service=self.access_service,
            ),
        )

    def test_lists_backends_and_zones_through_single_service(self) -> None:
        admin = User(username="admin", role=Role.ADMIN)
        editor = User(username="alice", role=Role.EDITOR)

        admin_backends = self.control_plane.list_backends(admin)
        admin_zones = self.control_plane.list_zones(admin)
        editor_zones = self.control_plane.list_zones(editor)
        editor_records = self.control_plane.list_records(editor, "example.com")

        self.assertEqual(
            [backend.name for backend in admin_backends],
            ["bind-lab", "powerdns-sandbox"],
        )
        self.assertEqual([zone.name for zone in admin_zones], ["example.com", "lab.example"])
        self.assertEqual([zone.name for zone in editor_zones], ["example.com"])
        self.assertEqual(
            [(record.name, record.record_type) for record in editor_records],
            [("www", "A")],
        )

    def test_record_mutations_are_audited_inside_service_layer(self) -> None:
        editor = User(username="alice", role=Role.EDITOR)

        created = self.control_plane.create_record(
            editor,
            RecordSet(
                zone_name="example.com",
                name="api",
                record_type="TXT",
                ttl=300,
                values=('"created"',),
            ),
        )
        updated = self.control_plane.update_record(
            editor,
            RecordSet(
                zone_name="example.com",
                name="api",
                record_type="TXT",
                ttl=600,
                values=('"updated"',),
            ),
        )
        self.control_plane.delete_record(
            editor,
            zone_name="example.com",
            name="api",
            record_type="TXT",
        )

        actions = [event.action for event in self.audit_repository.list_recent()]
        self.assertEqual(created.name, "api")
        self.assertEqual(updated.ttl, 600)
        self.assertEqual(actions, ["record.deleted", "record.updated", "record.created"])
        self.assertTrue(
            all(event.backend_name == "powerdns-sandbox" for event in self.audit_repository.events)
        )

    def test_backend_sync_uses_live_inventory_from_configured_adapter(self) -> None:
        self.bind_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="bind-lab",
        )

        synchronized = self.control_plane.sync_backend_zones("bind-lab")

        self.assertEqual([zone.name for zone in synchronized], ["ephemeral.example", "lab.example"])
        self.assertEqual(
            [zone.name for zone in self.access_service.list_accessible_zones(User(username="admin", role=Role.ADMIN))],
            ["ephemeral.example", "example.com", "lab.example"],
        )

    def test_discovery_reports_managed_and_new_backend_zones(self) -> None:
        self.bind_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="bind-lab",
        )

        discovered = self.control_plane.discover_backend_zones("bind-lab")

        self.assertEqual(
            [(zone.name, zone.managed) for zone in discovered],
            [("ephemeral.example", False), ("lab.example", True)],
        )

    def test_import_backend_zones_links_selected_discovered_zones(self) -> None:
        self.bind_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="bind-lab",
        )

        imported = self.control_plane.import_backend_zones(
            "bind-lab",
            zone_names=("ephemeral.example",),
        )

        self.assertEqual([zone.name for zone in imported], ["ephemeral.example"])
        self.assertEqual(
            [zone.name for zone in self.access_service.list_accessible_zones(User(username="admin", role=Role.ADMIN))],
            ["ephemeral.example", "example.com", "lab.example"],
        )

    def test_bulk_changes_validate_once_and_apply_as_single_service_call(self) -> None:
        editor = User(username="alice", role=Role.EDITOR)

        result = self.control_plane.apply_bulk_changes(
            editor,
            zone_name="example.com",
            changes=(
                BulkRecordChange(
                    operation=ChangeOperation.CREATE,
                    zone_name="example.com",
                    name="api",
                    record_type="TXT",
                    ttl=300,
                    values=('"created"',),
                ),
                BulkRecordChange(
                    operation=ChangeOperation.CREATE,
                    zone_name="example.com",
                    name="mx",
                    record_type="TXT",
                    ttl=300,
                    values=('"bulk"',),
                ),
            ),
        )

        self.assertTrue(result.applied)
        records = self.control_plane.list_records(editor, "example.com")
        self.assertIn(("api", "TXT"), [(record.name, record.record_type) for record in records])
        self.assertIn(("mx", "TXT"), [(record.name, record.record_type) for record in records])

    def test_bulk_changes_reject_duplicate_record_identities_without_writes(self) -> None:
        editor = User(username="alice", role=Role.EDITOR)

        result = self.control_plane.apply_bulk_changes(
            editor,
            zone_name="example.com",
            changes=(
                BulkRecordChange(
                    operation=ChangeOperation.CREATE,
                    zone_name="example.com",
                    name="api",
                    record_type="TXT",
                    ttl=300,
                    values=('"created"',),
                ),
                BulkRecordChange(
                    operation=ChangeOperation.UPDATE,
                    zone_name="example.com",
                    name="api",
                    record_type="TXT",
                    ttl=600,
                    values=('"updated"',),
                ),
            ),
        )

        self.assertFalse(result.applied)
        self.assertEqual(
            result.changes[1].conflict_reason,
            "duplicate record change in bulk set",
        )
        records = self.control_plane.list_records(editor, "example.com")
        self.assertNotIn(("api", "TXT"), [(record.name, record.record_type) for record in records])


if __name__ == "__main__":
    unittest.main()
