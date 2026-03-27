import unittest

from app.domain.models import PermissionGrant, Role, User, ZoneAction
from app.policy import PolicyEvaluator


class PolicyEvaluatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = PolicyEvaluator()
        self.admin = User(username="root", role=Role.ADMIN)
        self.editor = User(username="alice", role=Role.EDITOR)
        self.viewer = User(username="bob", role=Role.VIEWER)

    def test_admin_has_full_zone_and_system_access(self) -> None:
        zone_read = self.policy.is_zone_action_allowed(
            user=self.admin,
            zone_name="example.com",
            action=ZoneAction.READ,
        )
        zone_grant = self.policy.is_zone_action_allowed(
            user=self.admin,
            zone_name="example.com",
            action=ZoneAction.GRANT,
        )
        system_access = self.policy.can_manage_system(self.admin)

        self.assertTrue(zone_read.allowed)
        self.assertTrue(zone_grant.allowed)
        self.assertTrue(system_access.allowed)

    def test_editor_can_read_and_write_only_with_matching_grant(self) -> None:
        grant = PermissionGrant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.WRITE,),
        )

        read_decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="example.com",
            action=ZoneAction.READ,
            grants=(grant,),
        )
        write_decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="example.com",
            action=ZoneAction.WRITE,
            grants=(grant,),
        )
        other_zone_decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="other.example",
            action=ZoneAction.WRITE,
            grants=(grant,),
        )

        self.assertTrue(read_decision.allowed)
        self.assertTrue(write_decision.allowed)
        self.assertFalse(other_zone_decision.allowed)
        self.assertEqual(other_zone_decision.reason, "missing zone grant")

    def test_editor_cannot_grant_even_if_grant_contains_grant_action(self) -> None:
        grant = PermissionGrant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.GRANT,),
        )

        decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="example.com",
            action=ZoneAction.GRANT,
            grants=(grant,),
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "role does not permit action")

    def test_viewer_can_only_read_with_matching_grant(self) -> None:
        grant = PermissionGrant(
            username="bob",
            zone_name="example.com",
            actions=(ZoneAction.READ,),
        )

        read_decision = self.policy.is_zone_action_allowed(
            user=self.viewer,
            zone_name="example.com",
            action=ZoneAction.READ,
            grants=(grant,),
        )
        write_decision = self.policy.is_zone_action_allowed(
            user=self.viewer,
            zone_name="example.com",
            action=ZoneAction.WRITE,
            grants=(grant,),
        )
        system_access = self.policy.can_manage_system(self.viewer)

        self.assertTrue(read_decision.allowed)
        self.assertFalse(write_decision.allowed)
        self.assertEqual(write_decision.reason, "role does not permit action")
        self.assertFalse(system_access.allowed)

    def test_grant_action_implies_write_and_read_for_admin_capable_roles(self) -> None:
        grant = PermissionGrant(
            username="alice",
            zone_name="example.com",
            actions=(ZoneAction.GRANT,),
        )

        read_decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="example.com",
            action=ZoneAction.READ,
            grants=(grant,),
        )
        write_decision = self.policy.is_zone_action_allowed(
            user=self.editor,
            zone_name="example.com",
            action=ZoneAction.WRITE,
            grants=(grant,),
        )

        self.assertTrue(read_decision.allowed)
        self.assertTrue(write_decision.allowed)


if __name__ == "__main__":
    unittest.main()
