import unittest

from fastapi.testclient import TestClient

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryZoneRepository,
)
from app.api_tokens import ApiTokenService, InMemoryApiTokenRepository
from app.audit import AuditService, InMemoryAuditEventRepository
from app.auth import AuthService, InMemoryUserRepository, SessionManager
from app.domain.models import Backend, BackendCapability, RecordSet, Role, User, Zone, ZoneAction
from app.identity_providers import IdentityProviderService, InMemoryIdentityProviderRepository
from app.main import create_app
from app.security import hash_password
from app.zone_reads import ZoneReadService


class AuthBackedAccessUserRepository:
    def __init__(self, user_repository: InMemoryUserRepository) -> None:
        self.user_repository = user_repository

    def get_by_username(self, username: str) -> User | None:
        record = self.user_repository.get_by_username(username)
        if record is None or not record.is_active:
            return None
        return record.to_user()


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


class ApiTokenServiceTests(unittest.TestCase):
    def test_service_account_token_round_trip(self) -> None:
        users = InMemoryUserRepository(
            {
                "admin": {
                    "username": "admin",
                    "password_hash": hash_password("admin"),
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                }
            }
        )
        service = ApiTokenService(
            user_repository=users,
            repository=InMemoryApiTokenRepository(),
        )

        service_account = service.create_service_account(username="bot", role=Role.EDITOR)
        issued_token = service.issue_token(username="bot", token_name="ci")
        authenticated = service.authenticate(issued_token.token)

        self.assertEqual(service_account.auth_source, "service-account")
        self.assertIsNotNone(authenticated)
        assert authenticated is not None
        self.assertEqual(authenticated.username, "bot")
        self.assertEqual(authenticated.role, Role.EDITOR)


class ApiTokenApiTests(unittest.TestCase):
    def setUp(self) -> None:
        user_repository = InMemoryUserRepository(
            {
                "admin": {
                    "username": "admin",
                    "password_hash": hash_password("admin"),
                    "role": "admin",
                    "auth_source": "local",
                    "is_active": True,
                }
            }
        )
        auth_service = AuthService(
            user_repository=user_repository,
            session_manager=SessionManager(secret_key="test-secret"),
        )
        api_token_service = ApiTokenService(
            user_repository=user_repository,
            repository=InMemoryApiTokenRepository(),
        )
        access_service = AccessService(
            user_repository=AuthBackedAccessUserRepository(user_repository),
            backend_repository=InMemoryBackendRepository(),
            zone_repository=InMemoryZoneRepository(),
            grant_repository=InMemoryPermissionGrantRepository(),
        )
        access_service.register_backend(
            Backend(
                name="powerdns-sandbox",
                backend_type="powerdns",
                capabilities=(
                    BackendCapability.DISCOVER_ZONES,
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                ),
            )
        )
        access_service.register_zone(Zone(name="example.com", backend_name="powerdns-sandbox"))
        self.adapter = InMemoryZoneAdapter(
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
        zone_read_service = ZoneReadService(
            access_service=access_service,
            adapters={"powerdns-sandbox": self.adapter},
        )
        audit_service = AuditService(
            repository=InMemoryAuditEventRepository(),
            access_service=access_service,
        )
        identity_provider_service = IdentityProviderService(
            InMemoryIdentityProviderRepository()
        )

        self.client = TestClient(
            create_app(
                auth_service=auth_service,
                api_token_service=api_token_service,
                access_service=access_service,
                identity_provider_service=identity_provider_service,
                zone_read_service=zone_read_service,
                audit_service=audit_service,
            )
        )

    def csrf_headers(self) -> dict[str, str]:
        token = self.client.cookies.get("zonix_csrf_token")
        return {} if token is None else {"X-CSRF-Token": token}

    def test_admin_can_create_service_account_and_use_bearer_token_without_csrf(self) -> None:
        self.client.post("/auth/login", json={"username": "admin", "password": "admin"})

        create_account_response = self.client.post(
            "/admin/service-accounts",
            json={"username": "automation", "role": "editor"},
            headers=self.csrf_headers(),
        )
        grant_response = self.client.post(
            "/admin/grants/zones",
            json={"username": "automation", "zoneName": "example.com", "actions": ["write"]},
            headers=self.csrf_headers(),
        )
        token_response = self.client.post(
            "/admin/service-accounts/automation/tokens",
            json={"name": "ci"},
            headers=self.csrf_headers(),
        )
        bearer_headers = {"Authorization": f"Bearer {token_response.json()['token']}"}
        me_response = self.client.get("/auth/me", headers=bearer_headers)
        write_response = self.client.post(
            "/zones/example.com/records",
            json={
                "zoneName": "example.com",
                "name": "api",
                "recordType": "TXT",
                "ttl": 300,
                "values": ['"automated"'],
            },
            headers=bearer_headers,
        )

        self.assertEqual(create_account_response.status_code, 200)
        self.assertEqual(grant_response.status_code, 200)
        self.assertEqual(token_response.status_code, 200)
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["user"]["username"], "automation")
        self.assertEqual(write_response.status_code, 200)
        self.assertIn(
            ("api", "TXT"),
            [(record.name, record.record_type) for record in self.adapter.list_records("example.com")],
        )


if __name__ == "__main__":
    unittest.main()
