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
from app.domain.models import Backend, BackendCapability, RecordSet, Role, User, Zone, ZoneAction
from app.main import create_app
from app.security import hash_password
from app.zone_reads import ZoneReadService


class InMemoryZoneReadAdapter:
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


class MockApiTests(unittest.TestCase):
    def setUp(self) -> None:
        auth_repository = InMemoryUserRepository(
            {
                "admin": {
                    "username": "admin",
                    "password_hash": hash_password("admin"),
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                },
                "alice": {
                    "username": "alice",
                    "password_hash": hash_password("editor"),
                    "role": "editor",
                    "auth_source": "local",
                    "is_active": True,
                },
                "bob": {
                    "username": "bob",
                    "password_hash": hash_password("viewer"),
                    "role": "viewer",
                    "auth_source": "local",
                    "is_active": True,
                },
            }
        )
        auth_service = AuthService(
            user_repository=auth_repository,
            session_manager=SessionManager(secret_key="test-secret"),
        )

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
                name="powerdns-sandbox",
                backend_type="powerdns",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                ),
            )
        )
        access_service.register_backend(
            Backend(
                name="bind-lab",
                backend_type="rfc2136-bind",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.RFC2136_UPDATE),
            )
        )
        access_service.register_zone(Zone(name="example.com", backend_name="powerdns-sandbox"))
        access_service.register_zone(Zone(name="lab.example", backend_name="bind-lab"))
        access_service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE,),
        )

        self.powerdns_adapter = InMemoryZoneReadAdapter(
            zones=(Zone(name="example.com", backend_name="powerdns-sandbox"),),
            records={
                "example.com": (
                    RecordSet(
                        zone_name="example.com",
                        name="@",
                        record_type="SOA",
                        ttl=3600,
                        values=("ns1.example.com hostmaster.example.com 1 3600 600 1209600 3600",),
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
        )
        self.bind_adapter = InMemoryZoneReadAdapter(
            zones=(Zone(name="lab.example", backend_name="bind-lab"),),
            records={"lab.example": ()},
        )

        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={
                "powerdns-sandbox": self.powerdns_adapter,
                "bind-lab": self.bind_adapter,
            },
        )

        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                zone_read_service=zone_read_service,
            )
        )

    def test_backends_and_zones_require_authentication(self) -> None:
        backends_response = self.client.get("/backends")
        zones_response = self.client.get("/zones")
        zone_response = self.client.get("/zones/example.com")
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(backends_response.status_code, 401)
        self.assertEqual(zones_response.status_code, 401)
        self.assertEqual(zone_response.status_code, 401)
        self.assertEqual(records_response.status_code, 401)

    def test_admin_sees_all_mock_backends_and_zones(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        backends_response = self.client.get("/backends")
        zones_response = self.client.get("/zones")

        self.assertEqual(backends_response.status_code, 200)
        self.assertEqual(zones_response.status_code, 200)
        self.assertEqual(
            [backend["name"] for backend in backends_response.json()["items"]],
            ["bind-lab", "powerdns-sandbox"],
        )
        self.assertEqual(
            [zone["name"] for zone in zones_response.json()["items"]],
            ["example.com", "lab.example"],
        )

    def test_editor_sees_only_granted_mock_backend_and_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        backends_response = self.client.get("/backends")
        zones_response = self.client.get("/zones")

        self.assertEqual(backends_response.status_code, 200)
        self.assertEqual(zones_response.status_code, 200)
        self.assertEqual(
            [backend["name"] for backend in backends_response.json()["items"]],
            ["powerdns-sandbox"],
        )
        self.assertEqual(
            [zone["name"] for zone in zones_response.json()["items"]],
            ["example.com"],
        )

    def test_zone_detail_and_records_are_available_for_accessible_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        zone_response = self.client.get("/zones/example.com")
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(zone_response.status_code, 200)
        self.assertEqual(records_response.status_code, 200)
        self.assertEqual(zone_response.json()["backendName"], "powerdns-sandbox")
        self.assertEqual(
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
            [("@", "SOA"), ("www", "A")],
        )

    def test_zone_detail_hides_inaccessible_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        zone_response = self.client.get("/zones/lab.example")
        records_response = self.client.get("/zones/lab.example/records")

        self.assertEqual(zone_response.status_code, 404)
        self.assertEqual(records_response.status_code, 404)

    def test_admin_can_assign_and_list_zone_grants(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        assign_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "lab.example", "actions": ["write"]},
        )
        list_response = self.client.get("/admin/grants/bob")

        self.assertEqual(assign_response.status_code, 200)
        self.assertEqual(assign_response.json()["actions"], ["read", "write"])
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()["items"]), 1)
        self.assertEqual(list_response.json()["items"][0]["zoneName"], "lab.example")

    def test_non_admin_cannot_manage_zone_grants(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "lab.example", "actions": ["read"]},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "admin role required")

    def test_admin_sync_persists_live_zones_for_followup_grants(self) -> None:
        self.powerdns_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="powerdns-sandbox",
        )
        self.powerdns_adapter.records["ephemeral.example"] = ()
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        sync_response = self.client.post("/admin/backends/powerdns-sandbox/zones/sync")
        assign_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "ephemeral.example", "actions": ["read"]},
        )
        self.client.post("/auth/logout")
        self.client.post("/auth/login", json={"username": "bob", "password": "viewer"})
        zones_response = self.client.get("/zones")

        self.assertEqual(sync_response.status_code, 200)
        self.assertEqual(sync_response.json()["backendName"], "powerdns-sandbox")
        self.assertIn(
            "ephemeral.example",
            [zone["name"] for zone in sync_response.json()["syncedZones"]],
        )
        self.assertEqual(assign_response.status_code, 200)
        self.assertEqual(
            [zone["name"] for zone in zones_response.json()["items"]],
            ["ephemeral.example"],
        )


if __name__ == "__main__":
    unittest.main()
