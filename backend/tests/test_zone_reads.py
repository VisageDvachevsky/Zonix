import unittest

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.domain.models import Backend, BackendCapability, RecordSet, Role, User, Zone, ZoneAction
from app.zone_reads import ZoneNotFoundError, ZoneReadService


class InMemoryZoneReadAdapter:
    def __init__(
        self,
        zones: tuple[Zone, ...],
        records: dict[str, tuple[RecordSet, ...]],
    ) -> None:
        self._zones = {zone.name: zone for zone in zones}
        self._records = dict(records)

    def list_zones(self) -> tuple[Zone, ...]:
        return tuple(sorted(self._zones.values(), key=lambda zone: zone.name))

    def get_zone(self, zone_name: str) -> Zone | None:
        return self._zones.get(zone_name)

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]:
        return self._records.get(zone_name, ())


class FailingZoneReadAdapter:
    def list_zones(self) -> tuple[Zone, ...]:
        raise RuntimeError("upstream unavailable")

    def get_zone(self, zone_name: str) -> Zone | None:
        raise RuntimeError("upstream unavailable")

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]:
        raise RuntimeError("upstream unavailable")


class ZoneReadServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.access_service = AccessService(
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
        self.access_service.register_backend(
            Backend(
                name="powerdns-local",
                backend_type="powerdns",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.READ_RECORDS),
            )
        )
        self.access_service.register_backend(
            Backend(
                name="bind-lab",
                backend_type="rfc2136-bind",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.READ_RECORDS),
            )
        )

        self.access_service.register_zone(Zone(name="example.com", backend_name="powerdns-local"))
        self.access_service.register_zone(
            Zone(name="internal.example", backend_name="powerdns-local")
        )
        self.access_service.register_zone(Zone(name="lab.example", backend_name="bind-lab"))
        self.access_service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.READ,),
        )
        self.access_service.assign_zone_grant(
            username="bob",
            zone_name="lab.example",
            actions=(ZoneAction.READ,),
        )

        self.service = ZoneReadService(
            access_service=self.access_service,
            adapters={
                "powerdns-local": InMemoryZoneReadAdapter(
                    zones=(
                        Zone(name="example.com", backend_name="powerdns-local"),
                        Zone(name="internal.example", backend_name="powerdns-local"),
                    ),
                    records={
                        "example.com": (
                            RecordSet(
                                zone_name="example.com",
                                name="@",
                                record_type="SOA",
                                ttl=3600,
                                values=(
                                    "ns1.example.com hostmaster.example.com "
                                    "1 3600 600 1209600 3600",
                                ),
                            ),
                            RecordSet(
                                zone_name="example.com",
                                name="www",
                                record_type="A",
                                ttl=300,
                                values=("192.0.2.10",),
                            ),
                        )
                    },
                ),
                "bind-lab": InMemoryZoneReadAdapter(
                    zones=(Zone(name="lab.example", backend_name="bind-lab"),),
                    records={
                        "lab.example": (
                            RecordSet(
                                zone_name="lab.example",
                                name="@",
                                record_type="TXT",
                                ttl=300,
                                values=('"lab"',),
                            ),
                        )
                    },
                ),
            },
        )

    def test_admin_lists_all_live_zones(self) -> None:
        admin = User(username="admin", role=Role.ADMIN)

        zones = self.service.list_zones(admin)

        self.assertEqual(
            [zone.name for zone in zones], ["example.com", "internal.example", "lab.example"]
        )

    def test_non_admin_zone_list_is_filtered_by_grants(self) -> None:
        editor = User(username="alice", role=Role.EDITOR)
        viewer = User(username="bob", role=Role.VIEWER)

        editor_zones = self.service.list_zones(editor)
        viewer_zones = self.service.list_zones(viewer)

        self.assertEqual([zone.name for zone in editor_zones], ["example.com"])
        self.assertEqual([zone.name for zone in viewer_zones], ["lab.example"])

    def test_registered_zones_remain_visible_without_read_adapters(self) -> None:
        self.access_service.register_backend(
            Backend(
                name="manual-bind",
                backend_type="rfc2136-bind",
                capabilities=(BackendCapability.READ_ZONES,),
            )
        )
        self.access_service.register_zone(Zone(name="manual.example", backend_name="manual-bind"))

        zones = self.service.list_zones(User(username="admin", role=Role.ADMIN))

        self.assertEqual(
            [zone.name for zone in zones],
            ["example.com", "internal.example", "lab.example", "manual.example"],
        )

    def test_zone_detail_and_records_use_normalized_models(self) -> None:
        zone = self.service.get_zone(User(username="admin", role=Role.ADMIN), "example.com")
        records = self.service.list_records(User(username="admin", role=Role.ADMIN), "example.com")

        self.assertEqual(zone.backend_name, "powerdns-local")
        self.assertEqual(
            [(record.name, record.record_type) for record in records],
            [("@", "SOA"), ("www", "A")],
        )

    def test_missing_or_inaccessible_zone_returns_not_found(self) -> None:
        with self.assertRaises(ZoneNotFoundError):
            self.service.get_zone(User(username="alice", role=Role.EDITOR), "internal.example")

        with self.assertRaises(ZoneNotFoundError):
            self.service.get_zone(User(username="admin", role=Role.ADMIN), "ghost.example")

    def test_zone_inventory_uses_persisted_registry_when_backend_adapter_is_unhealthy(self) -> None:
        self.service = ZoneReadService(
            access_service=self.access_service,
            adapters={
                "powerdns-local": FailingZoneReadAdapter(),
                "bind-lab": InMemoryZoneReadAdapter(
                    zones=(Zone(name="lab.example", backend_name="bind-lab"),),
                    records={
                        "lab.example": (
                            RecordSet(
                                zone_name="lab.example",
                                name="@",
                                record_type="TXT",
                                ttl=300,
                                values=('"lab"',),
                            ),
                        )
                    },
                ),
            },
        )

        zones = self.service.list_zones(User(username="admin", role=Role.ADMIN))
        zone = self.service.get_zone(User(username="admin", role=Role.ADMIN), "example.com")

        self.assertEqual(
            [item.name for item in zones],
            ["example.com", "internal.example", "lab.example"],
        )
        self.assertEqual(zone.backend_name, "powerdns-local")


if __name__ == "__main__":
    unittest.main()
