import unittest

from fastapi.testclient import TestClient

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.audit import AuditService, InMemoryAuditEventRepository
from app.auth import AuthService, InMemoryUserRepository, SessionManager
from app.domain.models import Backend, BackendCapability, RecordSet, Role, User, Zone, ZoneAction
from app.identity_providers import IdentityProviderService, InMemoryIdentityProviderRepository
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
                "charlie": {
                    "username": "charlie",
                    "password_hash": hash_password("editor"),
                    "role": "editor",
                    "auth_source": "local",
                    "is_active": True,
                },
                "dave": {
                    "username": "dave",
                    "password_hash": hash_password("editor"),
                    "role": "editor",
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
                    "charlie": User(username="charlie", role=Role.EDITOR),
                    "dave": User(username="dave", role=Role.EDITOR),
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
        access_service.assign_zone_grant(
            username="bob",
            zone_name="lab.example",
            actions=(ZoneAction.READ,),
        )
        access_service.assign_zone_grant(
            username="charlie",
            zone_name="example.com",
            actions=(ZoneAction.READ,),
        )
        access_service.assign_zone_grant(
            username="dave",
            zone_name="lab.example",
            actions=(ZoneAction.READ,),
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
        identity_provider_service = IdentityProviderService(
            InMemoryIdentityProviderRepository()
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
            )
        )

    def csrf_headers(self) -> dict[str, str]:
        token = self.client.cookies.get("zonix_csrf_token")
        return {} if token is None else {"X-CSRF-Token": token}

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
        self.assertTrue(all(item["version"] for item in records_response.json()["items"]))

    def test_preview_update_returns_before_after_and_versions(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})
        current_version = next(
            item["version"]
            for item in self.client.get("/zones/example.com/records").json()["items"]
            if item["name"] == "www" and item["recordType"] == "A"
        )

        response = self.client.post(
            "/zones/example.com/changes/preview",
            json={
                "operation": "update",
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 600,
                "values": ["192.0.2.99"],
                "expectedVersion": current_version,
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["operation"], "update")
        self.assertEqual(response.json()["before"]["version"], current_version)
        self.assertEqual(response.json()["after"]["values"], ["192.0.2.99"])
        self.assertEqual(response.json()["currentVersion"], current_version)
        self.assertEqual(response.json()["hasConflict"], False)
        self.assertEqual(response.json()["summary"], "Update www A")

    def test_preview_create_detects_existing_record_conflict(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/changes/preview",
            json={
                "operation": "create",
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 300,
                "values": ["192.0.2.10"],
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["hasConflict"], True)
        self.assertEqual(response.json()["conflictReason"], "record already exists")
        self.assertEqual(response.json()["before"]["name"], "www")

    def test_bulk_apply_creates_multiple_records_with_one_request(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/changes/bulk",
            json={
                "zoneName": "example.com",
                "items": [
                    {
                        "operation": "create",
                        "name": "api",
                        "recordType": "TXT",
                        "ttl": 300,
                        "values": ['"created"'],
                    },
                    {
                        "operation": "create",
                        "name": "mail",
                        "recordType": "TXT",
                        "ttl": 300,
                        "values": ['"bulk"'],
                    },
                ],
            },
            headers=self.csrf_headers(),
        )
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["applied"], True)
        self.assertEqual(response.json()["hasConflicts"], False)
        self.assertEqual(len(response.json()["items"]), 2)
        self.assertIn(
            ("api", "TXT"),
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
        )
        self.assertIn(
            ("mail", "TXT"),
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
        )

    def test_bulk_apply_returns_validation_conflicts_without_partial_writes(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/changes/bulk",
            json={
                "zoneName": "example.com",
                "items": [
                    {
                        "operation": "create",
                        "name": "api",
                        "recordType": "TXT",
                        "ttl": 300,
                        "values": ['"created"'],
                    },
                    {
                        "operation": "update",
                        "name": "api",
                        "recordType": "TXT",
                        "ttl": 600,
                        "values": ['"updated"'],
                    },
                ],
            },
            headers=self.csrf_headers(),
        )
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["applied"], False)
        self.assertEqual(response.json()["hasConflicts"], True)
        self.assertEqual(
            response.json()["items"][1]["conflictReason"],
            "duplicate record change in bulk set",
        )
        self.assertNotIn(
            ("api", "TXT"),
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
        )

    def test_zone_detail_hides_inaccessible_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        zone_response = self.client.get("/zones/lab.example")
        records_response = self.client.get("/zones/lab.example/records")

        self.assertEqual(zone_response.status_code, 404)
        self.assertEqual(records_response.status_code, 404)

    def test_editor_can_create_record_for_powerdns_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        create_response = self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "api",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"created"'],
            },
            headers=self.csrf_headers(),
        )
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["recordType"], "TXT")
        self.assertIn(
            ("api", "TXT"),
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
        )

    def test_editor_can_update_existing_record_for_powerdns_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        current_version = next(
            item["version"]
            for item in self.client.get("/zones/example.com/records").json()["items"]
            if item["name"] == "www" and item["recordType"] == "A"
        )
        update_response = self.client.put(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 600,
                "values": ["192.0.2.99"],
                "expectedVersion": current_version,
            },
            headers=self.csrf_headers(),
        )
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["ttl"], 600)
        self.assertTrue(update_response.json()["version"])
        self.assertIn(
            ("www", "A", ["192.0.2.99"]),
            [
                (item["name"], item["recordType"], item["values"])
                for item in records_response.json()["items"]
            ],
        )

    def test_update_rejects_stale_expected_version(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        stale_version = next(
            item["version"]
            for item in self.client.get("/zones/example.com/records").json()["items"]
            if item["name"] == "www" and item["recordType"] == "A"
        )
        self.client.put(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 600,
                "values": ["192.0.2.99"],
            },
            headers=self.csrf_headers(),
        )

        response = self.client.put(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 900,
                "values": ["192.0.2.100"],
                "expectedVersion": stale_version,
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 409)
        self.assertIn("version conflict", response.json()["detail"])

    def test_editor_can_delete_existing_record_for_powerdns_zone(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        delete_response = self.client.request(
            "DELETE",
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
            },
            headers=self.csrf_headers(),
        )
        records_response = self.client.get("/zones/example.com/records")

        self.assertEqual(delete_response.status_code, 204)
        self.assertNotIn(
            ("www", "A"),
            [(item["name"], item["recordType"]) for item in records_response.json()["items"]],
        )

    def test_write_requires_zone_write_grant(self) -> None:
        self.client.post("/auth/login", json={"username": "charlie", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "api",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"blocked"'],
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 403)

    def test_write_rejects_zone_path_body_mismatch(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "internal.example",
                "name": "api",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"mismatch"'],
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 400)

    def test_write_rejects_backend_without_write_capability(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        response = self.client.post(
            "/zones/lab.example/records",
            json={
                "zoneName": "lab.example",
                "name": "api",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"unsupported"'],
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 400)

    def test_write_rejects_duplicate_record_creation(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "www",
                "recordType": "A",
                "ttl": 300,
                "values": ["192.0.2.10"],
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 409)

    def test_audit_lists_login_and_record_mutations(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})
        self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "audit",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"created"'],
            },
            headers=self.csrf_headers(),
        )
        self.client.put(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "audit",
                "recordType": "TXT",
                "ttl": 600,
                "values": ['"updated"'],
            },
            headers=self.csrf_headers(),
        )
        self.client.request(
            "DELETE",
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "audit",
                "recordType": "TXT",
            },
            headers=self.csrf_headers(),
        )

        audit_response = self.client.get("/audit")

        self.assertEqual(audit_response.status_code, 200)
        actions = [item["action"] for item in audit_response.json()["items"]]
        self.assertIn("login.success", actions)
        self.assertIn("record.created", actions)
        self.assertIn("record.updated", actions)
        self.assertIn("record.deleted", actions)
        record_events = [
            item for item in audit_response.json()["items"] if item["action"].startswith("record.")
        ]
        self.assertTrue(all(item["zoneName"] == "example.com" for item in record_events))
        self.assertTrue(all(item["backendName"] == "powerdns-sandbox" for item in record_events))

    def test_audit_is_filtered_by_accessible_zones_for_non_admin(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})
        self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "audit",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"created"'],
            },
            headers=self.csrf_headers(),
        )
        self.client.post("/auth/logout", headers=self.csrf_headers())
        self.client.post("/auth/login", json={"username": "bob", "password": "viewer"})

        audit_response = self.client.get("/audit")

        self.assertEqual(audit_response.status_code, 200)
        visible_zone_names = {item["zoneName"] for item in audit_response.json()["items"]}
        self.assertNotIn("example.com", visible_zone_names)

    def test_update_and_delete_require_existing_record(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        update_response = self.client.put(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "ghost",
                "recordType": "A",
                "ttl": 300,
                "values": ["192.0.2.200"],
            },
            headers=self.csrf_headers(),
        )
        delete_response = self.client.request(
            "DELETE",
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "ghost",
                "recordType": "A",
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(update_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)

    def test_admin_can_assign_and_list_zone_grants(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        assign_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "lab.example", "actions": ["write"]},
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/grants/bob")

        self.assertEqual(assign_response.status_code, 200)
        self.assertEqual(assign_response.json()["actions"], ["read", "write"])
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()["items"]), 1)
        self.assertEqual(list_response.json()["items"][0]["zoneName"], "lab.example")

    def test_admin_can_list_users(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        response = self.client.get("/admin/users")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["username"] for item in response.json()["items"]],
            ["admin", "alice", "bob", "charlie", "dave"],
        )
        self.assertEqual(response.json()["items"][0]["authSource"], "local")
        self.assertEqual(response.json()["items"][0]["isActive"], True)

    def test_admin_can_update_user_role(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        response = self.client.put(
            "/admin/users/bob/role",
            json={"role": "editor"},
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "bob")
        self.assertEqual(response.json()["role"], "editor")

    def test_admin_cannot_change_own_role_from_active_session(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        response = self.client.put(
            "/admin/users/admin/role",
            json={"role": "viewer"},
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"],
            "cannot change the active session user's global role",
        )

    def test_admin_can_register_and_list_backend_configs(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        create_response = self.client.post(
            "/admin/backends",
            json={
                "name": "edge-bind",
                "backendType": "rfc2136-bind",
                "capabilities": ["readZones", "rfc2136Update"],
            },
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/backends")

        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["name"], "edge-bind")
        self.assertEqual(
            create_response.json()["capabilities"],
            ["readZones", "rfc2136Update"],
        )
        self.assertEqual(list_response.status_code, 200)
        self.assertIn(
            "edge-bind",
            [item["name"] for item in list_response.json()["items"]],
        )

    def test_admin_can_delete_backend_config(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        delete_response = self.client.delete(
            "/admin/backends/bind-lab",
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/backends")

        self.assertEqual(delete_response.status_code, 204)
        self.assertNotIn(
            "bind-lab",
            [item["name"] for item in list_response.json()["items"]],
        )

    def test_admin_can_register_and_list_identity_provider_configs(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        create_response = self.client.post(
            "/admin/identity-providers",
            json={
                "name": "corp-oidc",
                "kind": "oidc",
                "issuer": "https://issuer.example",
                "clientId": "zonix-ui",
                "clientSecret": "secret",
                "scopes": ["openid", "profile", "email"],
                "claimsMappingRules": {
                    "usernameClaim": "preferred_username",
                    "rolesClaim": "groups",
                    "adminGroups": ["dns-admins"],
                },
            },
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/identity-providers")

        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(create_response.json()["name"], "corp-oidc")
        self.assertEqual(create_response.json()["kind"], "oidc")
        self.assertEqual(create_response.json()["hasClientSecret"], True)
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(len(list_response.json()["items"]), 1)
        self.assertEqual(list_response.json()["items"][0]["hasClientSecret"], True)
        self.assertEqual(
            list_response.json()["items"][0]["claimsMappingRules"]["rolesClaim"],
            "groups",
        )

    def test_admin_can_delete_identity_provider_config(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})
        self.client.post(
            "/admin/identity-providers",
            json={
                "name": "corp-oidc",
                "kind": "oidc",
                "issuer": "https://issuer.example",
                "clientId": "zonix-ui",
                "clientSecret": "secret",
                "scopes": ["openid", "profile"],
                "claimsMappingRules": {"rolesClaim": "groups"},
            },
            headers=self.csrf_headers(),
        )

        delete_response = self.client.delete(
            "/admin/identity-providers/corp-oidc",
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/identity-providers")

        self.assertEqual(delete_response.status_code, 204)
        self.assertEqual(list_response.json()["items"], [])

    def test_admin_can_update_identity_provider_without_resubmitting_secret(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})
        self.client.post(
            "/admin/identity-providers",
            json={
                "name": "corp-oidc",
                "kind": "oidc",
                "issuer": "https://issuer.example",
                "clientId": "zonix-ui",
                "clientSecret": "secret",
                "scopes": ["openid", "profile"],
                "claimsMappingRules": {"rolesClaim": "groups"},
            },
            headers=self.csrf_headers(),
        )

        update_response = self.client.post(
            "/admin/identity-providers",
            json={
                "name": "corp-oidc",
                "kind": "oidc",
                "issuer": "https://issuer.example/v2",
                "clientId": "zonix-admin",
                "scopes": ["openid", "email"],
                "claimsMappingRules": {"rolesClaim": "teams"},
            },
            headers=self.csrf_headers(),
        )
        list_response = self.client.get("/admin/identity-providers")

        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.json()["issuer"], "https://issuer.example/v2")
        self.assertEqual(update_response.json()["clientId"], "zonix-admin")
        self.assertEqual(update_response.json()["hasClientSecret"], True)
        self.assertEqual(list_response.json()["items"][0]["hasClientSecret"], True)
        self.assertEqual(
            list_response.json()["items"][0]["claimsMappingRules"]["rolesClaim"],
            "teams",
        )

    def test_non_admin_cannot_manage_zone_grants(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "lab.example", "actions": ["read"]},
            headers=self.csrf_headers(),
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "admin role required")

    def test_non_admin_cannot_manage_backend_or_identity_provider_configs(self) -> None:
        self.client.post("/auth/login", json={"username": "alice", "password": "editor"})

        backend_response = self.client.post(
            "/admin/backends",
            json={"name": "edge-bind", "backendType": "rfc2136-bind", "capabilities": []},
            headers=self.csrf_headers(),
        )
        provider_response = self.client.post(
            "/admin/identity-providers",
            json={
                "name": "corp-oidc",
                "kind": "oidc",
                "issuer": "https://issuer.example",
                "clientId": "zonix-ui",
                "clientSecret": "secret",
                "scopes": ["openid"],
                "claimsMappingRules": {},
            },
            headers=self.csrf_headers(),
        )

        self.assertEqual(backend_response.status_code, 403)
        self.assertEqual(provider_response.status_code, 403)

        role_response = self.client.put(
            "/admin/users/bob/role",
            json={"role": "editor"},
            headers=self.csrf_headers(),
        )
        self.assertEqual(role_response.status_code, 403)

    def test_admin_sync_persists_live_zones_for_followup_grants(self) -> None:
        self.powerdns_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="powerdns-sandbox",
        )
        self.powerdns_adapter.records["ephemeral.example"] = ()
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        sync_response = self.client.post(
            "/admin/backends/powerdns-sandbox/zones/sync",
            headers=self.csrf_headers(),
        )
        assign_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "ephemeral.example", "actions": ["read"]},
            headers=self.csrf_headers(),
        )
        self.client.post("/auth/logout", headers=self.csrf_headers())
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
            ["ephemeral.example", "lab.example"],
        )

    def test_admin_can_discover_and_import_backend_zones_before_granting_access(self) -> None:
        self.powerdns_adapter.zones["ephemeral.example"] = Zone(
            name="ephemeral.example",
            backend_name="powerdns-sandbox",
        )
        self.powerdns_adapter.records["ephemeral.example"] = ()
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        discover_response = self.client.get("/admin/backends/powerdns-sandbox/zones/discover")
        import_response = self.client.post(
            "/admin/backends/powerdns-sandbox/zones/import",
            json={"zoneNames": ["ephemeral.example"]},
            headers=self.csrf_headers(),
        )
        assign_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "bob", "zoneName": "ephemeral.example", "actions": ["read"]},
            headers=self.csrf_headers(),
        )
        self.client.post("/auth/logout", headers=self.csrf_headers())
        self.client.post("/auth/login", json={"username": "bob", "password": "viewer"})
        zones_response = self.client.get("/zones")

        self.assertEqual(discover_response.status_code, 200)
        self.assertIn(
            {"name": "ephemeral.example", "backendName": "powerdns-sandbox", "managed": False},
            discover_response.json()["items"],
        )
        self.assertEqual(import_response.status_code, 200)
        self.assertEqual(
            [item["name"] for item in import_response.json()["importedZones"]],
            ["ephemeral.example"],
        )
        self.assertEqual(assign_response.status_code, 200)
        self.assertEqual(
            [zone["name"] for zone in zones_response.json()["items"]],
            ["ephemeral.example", "lab.example"],
        )


if __name__ == "__main__":
    unittest.main()
