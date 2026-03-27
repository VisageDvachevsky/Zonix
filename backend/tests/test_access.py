import unittest

from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.domain.models import Backend, BackendCapability, Role, User, Zone, ZoneAction


class AccessServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.users = InMemoryUserDirectory(
            users={
                "root": User(username="root", role=Role.ADMIN),
                "alice": User(username="alice", role=Role.EDITOR),
                "bob": User(username="bob", role=Role.VIEWER),
            }
        )
        self.backends = InMemoryBackendRepository()
        self.zones = InMemoryZoneRepository()
        self.grants = InMemoryPermissionGrantRepository()
        self.service = AccessService(
            user_repository=self.users,
            backend_repository=self.backends,
            zone_repository=self.zones,
            grant_repository=self.grants,
        )

        self.service.register_backend(
            Backend(
                name="powerdns-prod",
                backend_type="powerdns",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.WRITE_RECORDS),
            )
        )
        self.service.register_backend(
            Backend(
                name="bind-lab",
                backend_type="rfc2136-bind",
                capabilities=(BackendCapability.READ_ZONES, BackendCapability.RFC2136_UPDATE),
            )
        )
        self.service.register_zone(Zone(name="example.com", backend_name="powerdns-prod"))
        self.service.register_zone(Zone(name="lab.example", backend_name="bind-lab"))

    def test_zone_registration_requires_existing_backend(self) -> None:
        with self.assertRaisesRegex(ValueError, "backend 'missing' is not registered"):
            self.service.register_zone(Zone(name="missing.example", backend_name="missing"))

    def test_assign_zone_grant_requires_existing_user_and_zone(self) -> None:
        with self.assertRaisesRegex(ValueError, "user 'nobody' does not exist"):
            self.service.assign_zone_grant(
                username="nobody",
                zone_name="example.com",
                actions=(ZoneAction.READ,),
            )

        with self.assertRaisesRegex(ValueError, "zone 'ghost.example' is not registered"):
            self.service.assign_zone_grant(
                username="alice",
                zone_name="ghost.example",
                actions=(ZoneAction.READ,),
            )

    def test_admin_users_do_not_require_zone_grants(self) -> None:
        with self.assertRaisesRegex(ValueError, "admin users do not require zone-level grants"):
            self.service.assign_zone_grant(
                username="root",
                zone_name="example.com",
                actions=(ZoneAction.READ,),
            )

    def test_zone_grants_are_normalized_and_upserted(self) -> None:
        grant = self.service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE, ZoneAction.WRITE),
        )

        self.assertEqual(grant.actions, (ZoneAction.READ, ZoneAction.WRITE))

        updated = self.service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.GRANT,),
        )
        self.assertEqual(updated.actions, (ZoneAction.READ, ZoneAction.WRITE, ZoneAction.GRANT))
        self.assertEqual(len(self.service.list_zone_grants_for_user("alice")), 1)

    def test_admin_sees_all_zones_and_backends(self) -> None:
        user = self.users.get_by_username("root")
        assert user is not None

        zones = self.service.list_accessible_zones(user)
        backends = self.service.list_accessible_backends(user)

        self.assertEqual([zone.name for zone in zones], ["example.com", "lab.example"])
        self.assertEqual([backend.name for backend in backends], ["bind-lab", "powerdns-prod"])

    def test_non_admin_access_is_resolved_from_zone_grants(self) -> None:
        self.service.assign_zone_grant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE,),
        )
        self.service.assign_zone_grant(
            username="bob",
            zone_name="lab.example",
            actions=(ZoneAction.READ,),
        )

        editor = self.users.get_by_username("alice")
        viewer = self.users.get_by_username("bob")
        assert editor is not None
        assert viewer is not None

        editor_zones = self.service.list_accessible_zones(editor)
        editor_backends = self.service.list_accessible_backends(editor)
        viewer_zones = self.service.list_accessible_zones(viewer)
        viewer_backends = self.service.list_accessible_backends(viewer)

        self.assertEqual([zone.name for zone in editor_zones], ["example.com"])
        self.assertEqual([backend.name for backend in editor_backends], ["powerdns-prod"])
        self.assertEqual([zone.name for zone in viewer_zones], ["lab.example"])
        self.assertEqual([backend.name for backend in viewer_backends], ["bind-lab"])

    def test_empty_zone_grants_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "zone grant must include at least one action"):
            self.service.assign_zone_grant(
                username="alice",
                zone_name="example.com",
                actions=(),
            )


if __name__ == "__main__":
    unittest.main()
