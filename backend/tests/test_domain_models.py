import unittest

from pydantic import ValidationError

from app.domain.models import (
    AuditEvent,
    Backend,
    BackendCapability,
    ChangeSet,
    IdentityProvider,
    PermissionGrant,
    RecordSet,
    Role,
    User,
    Zone,
    ZoneAction,
)


class DomainModelTests(unittest.TestCase):
    def test_roles_are_fixed_to_mvp_set(self) -> None:
        self.assertEqual([role.value for role in Role], ["admin", "editor", "viewer"])

    def test_zone_actions_are_fixed_to_minimal_contract(self) -> None:
        self.assertEqual([action.value for action in ZoneAction], ["read", "write", "grant"])

    def test_backend_capabilities_cover_core_read_write_and_discovery(self) -> None:
        self.assertEqual(
            [capability.value for capability in BackendCapability],
            [
                "readZones",
                "readRecords",
                "writeRecords",
                "discoverZones",
                "importSnapshot",
                "commentsMetadata",
                "axfr",
                "rfc2136Update",
            ],
        )

    def test_user_requires_valid_role(self) -> None:
        user = User(username="admin", role=Role.ADMIN)
        self.assertEqual(user.role, Role.ADMIN)

        with self.assertRaises(ValidationError):
            User(username="admin", role="superuser")

    def test_core_models_can_be_instantiated(self) -> None:
        grant = PermissionGrant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.READ, ZoneAction.WRITE),
        )
        provider = IdentityProvider(
            name="corp-oidc",
            kind="oidc",
            issuer="https://issuer.example",
        )
        backend = Backend(
            name="powerdns-prod",
            backend_type="powerdns",
            capabilities=(BackendCapability.READ_ZONES, BackendCapability.WRITE_RECORDS),
        )
        zone = Zone(name="example.com", backend_name=backend.name)
        record_set = RecordSet(
            zone_name=zone.name,
            name="www",
            record_type="A",
            ttl=300,
            values=("192.0.2.10",),
        )
        change_set = ChangeSet(actor="alice", zone_name=zone.name, summary="create A record")
        audit_event = AuditEvent(
            actor="alice",
            action="record.created",
            zone_name=zone.name,
            backend_name=backend.name,
        )

        self.assertEqual(grant.zone_name, "example.com")
        self.assertEqual(grant.actions, (ZoneAction.READ, ZoneAction.WRITE))
        self.assertEqual(provider.name, "corp-oidc")
        self.assertEqual(provider.kind, "oidc")
        self.assertEqual(backend.backend_type, "powerdns")
        self.assertEqual(record_set.record_type, "A")
        self.assertEqual(change_set.actor, "alice")
        self.assertEqual(audit_event.action, "record.created")

    def test_audit_event_requires_actor_and_action(self) -> None:
        event = AuditEvent(actor="alice", action="login.success")
        self.assertEqual(event.actor, "alice")
        self.assertEqual(event.action, "login.success")

        with self.assertRaises(ValidationError):
            AuditEvent(actor="", action="login.success")


if __name__ == "__main__":
    unittest.main()
