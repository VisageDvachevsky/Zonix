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
from app.rfc2136 import RFC2136Adapter, RFC2136Client
from app.security import hash_password
from app.zone_reads import UpstreamReadError, ZoneReadService


class RFC2136ApiFlowIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        server_host = os.getenv("ZONIX_BIND_SERVER_HOST")
        server_port = int(os.getenv("ZONIX_BIND_SERVER_PORT", "53"))
        backend_name = os.getenv("ZONIX_BIND_BACKEND_NAME", "bind-lab")
        zone_name = os.getenv("ZONIX_BIND_TEST_ZONE", "lab.example")
        tsig_key_name = os.getenv("ZONIX_BIND_TSIG_KEY_NAME")
        tsig_secret = os.getenv("ZONIX_BIND_TSIG_SECRET")
        tsig_algorithm = os.getenv("ZONIX_BIND_TSIG_ALGORITHM", "hmac-sha256")

        if not server_host or not tsig_key_name or not tsig_secret:
            self.skipTest("live RFC2136 flow requires bind env vars")

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
                backend_type="rfc2136-bind",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                    BackendCapability.AXFR,
                    BackendCapability.RFC2136_UPDATE,
                ),
            )
        )

        adapter = RFC2136Adapter(
            backend_name=backend_name,
            zone_names=(zone_name,),
            client=RFC2136Client(
                server_host=server_host,
                port=server_port,
                timeout_seconds=5.0,
                tsig_key_name=tsig_key_name,
                tsig_secret=tsig_secret,
                tsig_algorithm=tsig_algorithm,
            ),
            axfr_enabled=True,
        )
        try:
            adapter.list_records(zone_name)
        except UpstreamReadError as error:
            self.skipTest(f"live RFC2136 flow requires healthy upstream: {error}")

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

    def csrf_headers(self) -> dict[str, str]:
        token = self.client.cookies.get("zonix_csrf_token")
        return {} if token is None else {"X-CSRF-Token": token}

    def test_live_api_flow_login_open_zone_edit_record_and_see_audit(self) -> None:
        record_name = f"zonix-bind-{uuid4().hex[:8]}"

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
                "values": ['"bind-created"'],
            },
            headers=self.csrf_headers(),
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
                    "values": ['"bind-updated"'],
                    "expectedVersion": created_version,
                },
                headers=self.csrf_headers(),
            )
            self.assertEqual(update_response.status_code, 200)
            self.assertEqual(update_response.json()["ttl"], 600)
            self.assertEqual(update_response.json()["values"], ['"bind-updated"'])

            updated_records_response = self.client.get(f"/zones/{self.zone_name}/records")
            self.assertEqual(updated_records_response.status_code, 200)
            self.assertIn(
                (record_name, "TXT", ['"bind-updated"']),
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
        finally:
            self.client.request(
                "DELETE",
                f"/zones/{self.zone_name}/records",
                json={
                    "zoneName": self.zone_name,
                    "name": record_name,
                    "recordType": "TXT",
                },
                headers=self.csrf_headers(),
            )


if __name__ == "__main__":
    unittest.main()
