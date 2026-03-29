import tempfile
import unittest
from pathlib import Path

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
from app.rfc2136 import RFC2136Adapter, RFC2136Client, build_file_snapshot_readers
from app.security import hash_password
from app.zone_reads import ZoneReadService


class RFC2136SnapshotFlowIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
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
                name="bind-snapshot",
                backend_type="rfc2136-bind",
                capabilities=(
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.IMPORT_SNAPSHOT,
                ),
            )
        )

        self.temp_dir = tempfile.TemporaryDirectory()
        snapshot_path = Path(self.temp_dir.name) / "lab.example.zone"
        snapshot_path.write_text(
            "\n".join(
                (
                    "$TTL 300",
                    "@   IN  SOA ns1.lab.example. hostmaster.lab.example. (",
                    "        2026032901",
                    "        3600",
                    "        600",
                    "        1209600",
                    "        300",
                    ")",
                    "@       IN  NS      ns1.lab.example.",
                    "ns1     IN  A       192.0.2.53",
                    "txt     IN  TXT     \"snapshot-only\"",
                )
            ),
            encoding="utf-8",
        )

        adapter = RFC2136Adapter(
            backend_name="bind-snapshot",
            zone_names=("lab.example",),
            client=RFC2136Client(
                server_host="bind-disabled",
                axfr_fetcher=lambda _zone_name: (_ for _ in ()).throw(
                    AssertionError("AXFR must not be called when snapshot fallback is selected")
                ),
            ),
            axfr_enabled=False,
            snapshot_readers=build_file_snapshot_readers({"lab.example": str(snapshot_path)}),
        )

        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={"bind-snapshot": adapter},
        )
        audit_service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )

        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                access_service=access_service,
                zone_read_service=zone_read_service,
                audit_service=audit_service,
            )
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_snapshot_reader_powers_bind_zone_read_api_without_axfr(self) -> None:
        login_response = self.client.post(
            "/auth/login",
            json={"username": "admin", "password": "admin"},
        )
        self.assertEqual(login_response.status_code, 200)

        zone_response = self.client.get("/zones/lab.example")
        records_response = self.client.get("/zones/lab.example/records")

        self.assertEqual(zone_response.status_code, 200)
        self.assertEqual(zone_response.json()["backendName"], "bind-snapshot")
        self.assertEqual(records_response.status_code, 200)
        self.assertIn(
            ("txt", "TXT", ['"snapshot-only"']),
            [
                (item["name"], item["recordType"], item["values"])
                for item in records_response.json()["items"]
            ],
        )


if __name__ == "__main__":
    unittest.main()
