import unittest

from pydantic import ValidationError

from app.domain.models import (
    AuditEvent,
    Backend,
    BackendCapability,
    ChangeOperation,
    ChangeSet,
    IdentityProvider,
    IdentityProviderKind,
    PermissionGrant,
    RecordSet,
    RecordType,
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
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid", "profile", "email"),
            claimsMappingRules={
                "rolesClaim": "groups",
                "zoneEditorPattern": "zone-{zone}-editors",
            },
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
        change_set = ChangeSet(
            actor="alice",
            zone_name=zone.name,
            backend_name=backend.name,
            operation=ChangeOperation.CREATE,
            before=None,
            after=record_set,
            summary="create A record",
        )
        audit_event = AuditEvent(
            actor="alice",
            action="record.created",
            zone_name=zone.name,
            backend_name=backend.name,
        )

        self.assertEqual(grant.zone_name, "example.com")
        self.assertEqual(grant.actions, (ZoneAction.READ, ZoneAction.WRITE))
        self.assertEqual(provider.name, "corp-oidc")
        self.assertEqual(provider.kind, IdentityProviderKind.OIDC)
        self.assertEqual(provider.client_id, "zonix-ui")
        self.assertEqual(provider.scopes, ("openid", "profile", "email"))
        self.assertEqual(backend.backend_type, "powerdns")
        self.assertEqual(record_set.record_type, "A")
        self.assertEqual(change_set.actor, "alice")
        self.assertEqual(audit_event.action, "record.created")

    def test_identity_provider_requires_oidc_credentials_scope_and_mapping_shape(self) -> None:
        provider = IdentityProvider(
            name="corp-oidc",
            kind=IdentityProviderKind.OIDC,
            issuer="https://issuer.example",
            clientId="zonix-ui",
            clientSecret="super-secret",
            scopes=("openid", "profile", "openid"),
            claimsMappingRules={"rolesClaim": "groups"},
        )

        self.assertEqual(provider.scopes, ("openid", "profile"))

        with self.assertRaises(ValidationError):
            IdentityProvider(
                name="corp-oidc",
                kind=IdentityProviderKind.OIDC,
                issuer="https://issuer.example",
                clientId="",
                clientSecret="super-secret",
                scopes=("openid",),
                claimsMappingRules={"rolesClaim": "groups"},
            )

        with self.assertRaises(ValidationError):
            IdentityProvider(
                name="corp-oidc",
                kind=IdentityProviderKind.OIDC,
                issuer="https://issuer.example",
                clientId="zonix-ui",
                clientSecret="super-secret",
                scopes=("openid", ""),
                claimsMappingRules={"rolesClaim": "groups"},
            )

    def test_record_type_enum_covers_day_11_core_types(self) -> None:
        self.assertEqual(
            [record_type.value for record_type in RecordType],
            ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA", "SOA"],
        )

    def test_record_set_normalizes_record_type_to_uppercase(self) -> None:
        record_set = RecordSet(
            zone_name="example.com",
            name="www",
            record_type="a",
            ttl=300,
            values=("192.0.2.10",),
        )

        self.assertEqual(record_set.record_type, "A")

    def test_record_set_validates_supported_day_11_types(self) -> None:
        records = (
            RecordSet(
                zone_name="example.com",
                name="www",
                record_type="A",
                ttl=300,
                values=("192.0.2.10",),
            ),
            RecordSet(
                zone_name="example.com",
                name="www",
                record_type="AAAA",
                ttl=300,
                values=("2001:db8::10",),
            ),
            RecordSet(
                zone_name="example.com",
                name="mail",
                record_type="MX",
                ttl=300,
                values=("10 mail.example.com",),
            ),
            RecordSet(
                zone_name="example.com",
                name="_sip._tcp",
                record_type="SRV",
                ttl=300,
                values=("10 20 5060 sip.example.com",),
            ),
            RecordSet(
                zone_name="example.com",
                name="@",
                record_type="CAA",
                ttl=300,
                values=('0 issue "letsencrypt.org"',),
            ),
        )

        self.assertEqual([record.record_type for record in records], ["A", "AAAA", "MX", "SRV", "CAA"])

    def test_record_set_rejects_invalid_typed_values(self) -> None:
        with self.assertRaises(ValidationError):
            RecordSet(
                zone_name="example.com",
                name="www",
                record_type="A",
                ttl=300,
                values=("not-an-ip",),
            )

        with self.assertRaises(ValidationError):
            RecordSet(
                zone_name="example.com",
                name="alias",
                record_type="CNAME",
                ttl=300,
                values=("target.example.com", "second.example.com"),
            )

        with self.assertRaises(ValidationError):
            RecordSet(
                zone_name="example.com",
                name="mail",
                record_type="MX",
                ttl=300,
                values=("mail.example.com",),
            )

        with self.assertRaises(ValidationError):
            RecordSet(
                zone_name="example.com",
                name="_sip._tcp",
                record_type="SRV",
                ttl=300,
                values=("10 20 sip.example.com",),
            )

    def test_audit_event_requires_actor_and_action(self) -> None:
        event = AuditEvent(actor="alice", action="login.success")
        self.assertEqual(event.actor, "alice")
        self.assertEqual(event.action, "login.success")

        with self.assertRaises(ValidationError):
            AuditEvent(actor="", action="login.success")


if __name__ == "__main__":
    unittest.main()
