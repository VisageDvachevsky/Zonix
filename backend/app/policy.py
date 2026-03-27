from __future__ import annotations

from dataclasses import dataclass

from app.domain.models import PermissionGrant, Role, User, ZoneAction


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str


class PolicyEvaluator:
    def is_zone_action_allowed(
        self,
        user: User,
        zone_name: str,
        action: ZoneAction,
        grants: tuple[PermissionGrant, ...] = (),
    ) -> PolicyDecision:
        if user.role == Role.ADMIN:
            return PolicyDecision(allowed=True, reason="global admin")

        matching_grant = self._find_grant(user.username, zone_name, grants)
        if matching_grant is None:
            return PolicyDecision(allowed=False, reason="missing zone grant")

        effective_actions = set(matching_grant.actions)
        if ZoneAction.WRITE in effective_actions:
            effective_actions.add(ZoneAction.READ)
        if ZoneAction.GRANT in effective_actions:
            effective_actions.update((ZoneAction.READ, ZoneAction.WRITE))

        role_ceiling = self._role_ceiling(user.role)
        if action not in role_ceiling:
            return PolicyDecision(allowed=False, reason="role does not permit action")

        if action not in effective_actions:
            return PolicyDecision(allowed=False, reason="grant does not permit action")

        return PolicyDecision(allowed=True, reason="zone grant allows action")

    def can_manage_system(self, user: User) -> PolicyDecision:
        if user.role == Role.ADMIN:
            return PolicyDecision(allowed=True, reason="global admin")
        return PolicyDecision(allowed=False, reason="requires admin role")

    @staticmethod
    def _find_grant(
        username: str,
        zone_name: str,
        grants: tuple[PermissionGrant, ...],
    ) -> PermissionGrant | None:
        for grant in grants:
            if grant.username == username and grant.zone_name == zone_name:
                return grant
        return None

    @staticmethod
    def _role_ceiling(role: Role) -> set[ZoneAction]:
        if role == Role.EDITOR:
            return {ZoneAction.READ, ZoneAction.WRITE}
        if role == Role.VIEWER:
            return {ZoneAction.READ}
        return set()
