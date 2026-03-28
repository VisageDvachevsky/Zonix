import os
import unittest
from uuid import uuid4

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
from app.domain.models import Backend, BackendCapability, Role, User
from app.main import create_app
from app.powerdns import PowerDNSClient, PowerDNSReadAdapter
from app.security import hash_password
from app.zone_reads import UpstreamReadError, ZoneReadService


class PowerDNSApiFlowIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        api_url = os.getenv("ZONIX_POWERDNS_API_URL")
        api_key = os.getenv("ZONIX_POWERDNS_API_KEY")
        server_id = os.getenv("ZONIX_POWERDNS_SERVER_ID", "localhost")
        backend_name = os.getenv("ZONIX_POWERDNS_BACKEND_NAME", "powerdns-local")
        zone_name = os.getenv("ZONIX_POWERDNS_TEST_ZONE", "example.com")

        if not api_url or not api_key:
            self.skipTest("live API flow requires PowerDNS env vars")

        auth_service = AuthService(
            user_repository=InMemoryUserRepository(
                {
                    "admin": {
                        "username": "admin",
                        "password_hash": hash_password("admin"),
                        "role": "admin",
                        "auth_source": "local",
                        "is_active": True,
                    }
                }
            ),
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
        access_service.register_backend(
            Backend(
                name=backend_name,
                backend_type="powerdns",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                ),
            )
        )

        adapter = PowerDNSReadAdapter(
            backend_name=backend_name,
            client=PowerDNSClient(
                api_url=api_url,
                api_key=api_key,
                server_id=server_id,
                timeout_seconds=5.0,
            ),
        )
        try:
            adapter.get_zone(zone_name)
        except UpstreamReadError as error:
            self.skipTest(f"live API flow requires healthy upstream: {error}")

        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={backend_name: adapter},
        )
        audit_service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )

        self.zone_name = zone_name
        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                zone_read_service=zone_read_service,
                audit_service=audit_service,
            )
        )

    def test_live_api_flow_login_open_zone_edit_record_and_see_audit(self) -> None:
        record_name = f"zonix-day15-{uuid4().hex[:8]}"

        login_response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        self.assertEqual(login_response.status_code, 200)

        zone_response = self.client.get(f"/zones/{self.zone_name}")
        records_response = self.client.get(f"/zones/{self.zone_name}/records")
        self.assertEqual(zone_response.status_code, 200)
        self.assertEqual(records_response.status_code, 200)
        self.assertEqual(zone_response.json()["name"], self.zone_name)

        create_response = self.client.post(
            f"/zones/{self.zone_name}/records",
            json={
                "zoneName": self.zone_name,
                "name": record_name,
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"day15-created"'],
            },
        )
        if create_response.status_code == 502 and "does not support editing records" in str(
            create_response.json().get("detail", "")
        ):
            self.skipTest(
                f"live API flow requires writable PowerDNS fixture: {create_response.json()['detail']}"
            )
        self.assertEqual(create_response.status_code, 200)

        created_version = create_response.json()["version"]

        try:
            update_response = self.client.put(
                f"/zones/{self.zone_name}/records",
                json={
                    "zoneName": self.zone_name,
                    "name": record_name,
                    "recordType": "TXT",
                    "ttl": 600,
                    "values": ['"day15-updated"'],
                    "expectedVersion": created_version,
                },
            )
            self.assertEqual(update_response.status_code, 200)
            self.assertEqual(update_response.json()["ttl"], 600)
            self.assertEqual(update_response.json()["values"], ['"day15-updated"'])

            updated_records_response = self.client.get(f"/zones/{self.zone_name}/records")
            self.assertEqual(updated_records_response.status_code, 200)
            self.assertIn(
                (record_name, "TXT", ['"day15-updated"']),
                [
                    (item["name"], item["recordType"], item["values"])
                    for item in updated_records_response.json()["items"]
                ],
            )

            audit_response = self.client.get("/audit")
            self.assertEqual(audit_response.status_code, 200)
            actions = [item["action"] for item in audit_response.json()["items"]]
            self.assertIn("login.success", actions)
            self.assertIn("record.created", actions)
            self.assertIn("record.updated", actions)
            update_event = next(
                item
                for item in audit_response.json()["items"]
                if item["action"] == "record.updated"
                and item["payload"].get("name") == record_name
            )
            self.assertEqual(update_event["zoneName"], self.zone_name)
            self.assertEqual(update_event["payload"]["values"], ['"day15-updated"'])
        finally:
            self.client.request(
                "DELETE",
                f"/zones/{self.zone_name}/records",
                json={
                    "zoneName": self.zone_name,
                    "name": record_name,
                    "recordType": "TXT",
                },
            )


if __name__ == "__main__":
    unittest.main()
