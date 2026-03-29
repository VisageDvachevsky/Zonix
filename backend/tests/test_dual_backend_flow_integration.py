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
from app.rfc2136 import RFC2136Adapter, RFC2136Client
from app.security import hash_password
from app.zone_reads import UpstreamReadError, ZoneReadService


class DualBackendApiFlowIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        powerdns_api_url = os.getenv("ZONIX_POWERDNS_API_URL")
        powerdns_api_key = os.getenv("ZONIX_POWERDNS_API_KEY")
        powerdns_server_id = os.getenv("ZONIX_POWERDNS_SERVER_ID", "localhost")
        powerdns_backend_name = os.getenv("ZONIX_POWERDNS_BACKEND_NAME", "powerdns-local")
        powerdns_zone_name = os.getenv("ZONIX_POWERDNS_TEST_ZONE", "example.com")

        bind_server_host = os.getenv("ZONIX_BIND_SERVER_HOST")
        bind_server_port = int(os.getenv("ZONIX_BIND_SERVER_PORT", "53"))
        bind_backend_name = os.getenv("ZONIX_BIND_BACKEND_NAME", "bind-lab")
        bind_zone_name = os.getenv("ZONIX_BIND_TEST_ZONE", "lab.example")
        bind_tsig_key_name = os.getenv("ZONIX_BIND_TSIG_KEY_NAME")
        bind_tsig_secret = os.getenv("ZONIX_BIND_TSIG_SECRET")
        bind_tsig_algorithm = os.getenv("ZONIX_BIND_TSIG_ALGORITHM", "hmac-sha256")

        if (
            not powerdns_api_url
            or not powerdns_api_key
            or not bind_server_host
            or not bind_tsig_key_name
            or not bind_tsig_secret
        ):
            self.skipTest("dual-backend flow requires both PowerDNS and RFC2136 env vars")

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
                name=powerdns_backend_name,
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
                name=bind_backend_name,
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

        powerdns_adapter = PowerDNSReadAdapter(
            backend_name=powerdns_backend_name,
            client=PowerDNSClient(
                api_url=powerdns_api_url,
                api_key=powerdns_api_key,
                server_id=powerdns_server_id,
                timeout_seconds=5.0,
            ),
        )
        bind_adapter = RFC2136Adapter(
            backend_name=bind_backend_name,
            zone_names=(bind_zone_name,),
            client=RFC2136Client(
                server_host=bind_server_host,
                port=bind_server_port,
                timeout_seconds=5.0,
                tsig_key_name=bind_tsig_key_name,
                tsig_secret=bind_tsig_secret,
                tsig_algorithm=bind_tsig_algorithm,
            ),
            axfr_enabled=True,
        )

        try:
            if powerdns_adapter.get_zone(powerdns_zone_name) is None:
                self.skipTest(f"PowerDNS zone '{powerdns_zone_name}' not found")
            bind_adapter.list_records(bind_zone_name)
        except UpstreamReadError as error:
            self.skipTest(f"dual-backend flow requires healthy upstreams: {error}")

        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={
                powerdns_backend_name: powerdns_adapter,
                bind_backend_name: bind_adapter,
            },
        )
        audit_service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )

        self.powerdns_zone_name = powerdns_zone_name
        self.bind_zone_name = bind_zone_name
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

    def test_admin_can_operate_on_powerdns_and_bind_in_one_runtime(self) -> None:
        powerdns_record_name = f"zonix-pdns-{uuid4().hex[:8]}"
        bind_record_name = f"zonix-bind-{uuid4().hex[:8]}"

        login_response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        self.assertEqual(login_response.status_code, 200)

        zones_response = self.client.get("/zones")
        self.assertEqual(zones_response.status_code, 200)
        visible_zone_names = [item["name"] for item in zones_response.json()["items"]]
        self.assertIn(self.powerdns_zone_name, visible_zone_names)
        self.assertIn(self.bind_zone_name, visible_zone_names)

        powerdns_create = self.client.post(
            f"/zones/{self.powerdns_zone_name}/records",
            json={
                "zoneName": self.powerdns_zone_name,
                "name": powerdns_record_name,
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"dual-powerdns"'],
            },
            headers=self.csrf_headers(),
        )
        self.assertEqual(powerdns_create.status_code, 200)

        bind_create = self.client.post(
            f"/zones/{self.bind_zone_name}/records",
            json={
                "zoneName": self.bind_zone_name,
                "name": bind_record_name,
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"dual-bind"'],
            },
            headers=self.csrf_headers(),
        )
        self.assertEqual(bind_create.status_code, 200)

        try:
            powerdns_records = self.client.get(f"/zones/{self.powerdns_zone_name}/records")
            bind_records = self.client.get(f"/zones/{self.bind_zone_name}/records")

            self.assertEqual(powerdns_records.status_code, 200)
            self.assertEqual(bind_records.status_code, 200)
            self.assertIn(
                (powerdns_record_name, "TXT", ['"dual-powerdns"']),
                [
                    (item["name"], item["recordType"], item["values"])
                    for item in powerdns_records.json()["items"]
                ],
            )
            self.assertIn(
                (bind_record_name, "TXT", ['"dual-bind"']),
                [
                    (item["name"], item["recordType"], item["values"])
                    for item in bind_records.json()["items"]
                ],
            )

            audit_response = self.client.get("/audit")
            self.assertEqual(audit_response.status_code, 200)
            record_events = [
                item
                for item in audit_response.json()["items"]
                if item["action"] == "record.created"
            ]
            self.assertIn(
                (self.powerdns_zone_name, powerdns_record_name),
                [(item["zoneName"], item["payload"]["name"]) for item in record_events],
            )
            self.assertIn(
                (self.bind_zone_name, bind_record_name),
                [(item["zoneName"], item["payload"]["name"]) for item in record_events],
            )
        finally:
            self.client.request(
                "DELETE",
                f"/zones/{self.powerdns_zone_name}/records",
                json={
                    "zoneName": self.powerdns_zone_name,
                    "name": powerdns_record_name,
                    "recordType": "TXT",
                },
                headers=self.csrf_headers(),
            )
            self.client.request(
                "DELETE",
                f"/zones/{self.bind_zone_name}/records",
                json={
                    "zoneName": self.bind_zone_name,
                    "name": bind_record_name,
                    "recordType": "TXT",
                },
                headers=self.csrf_headers(),
            )


if __name__ == "__main__":
    unittest.main()
