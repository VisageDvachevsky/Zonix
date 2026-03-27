from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol

from app.database import connect
from app.domain.models import (
    Backend,
    BackendCapability,
    PermissionGrant,
    Role,
    User,
    Zone,
    ZoneAction,
)
from app.policy import PolicyEvaluator


class UserRepository(Protocol):
    def get_by_username(self, username: str) -> User | None: ...


class BackendRepository(Protocol):
    def add(self, backend: Backend) -> None: ...

    def list_all(self) -> tuple[Backend, ...]: ...

    def get_by_name(self, name: str) -> Backend | None: ...


class ZoneRepository(Protocol):
    def add(self, zone: Zone) -> None: ...

    def replace_for_backend(self, backend_name: str, zones: Iterable[Zone]) -> tuple[Zone, ...]: ...

    def list_all(self) -> tuple[Zone, ...]: ...

    def get_by_name(self, name: str) -> Zone | None: ...


class PermissionGrantRepository(Protocol):
    def upsert(self, grant: PermissionGrant) -> None: ...

    def list_for_user(self, username: str) -> tuple[PermissionGrant, ...]: ...


@dataclass
class InMemoryUserDirectory:
    users: dict[str, User]

    def get_by_username(self, username: str) -> User | None:
        return self.users.get(username)


@dataclass
class InMemoryBackendRepository:
    backends: dict[str, Backend] | None = None

    def __post_init__(self) -> None:
        self.backends = {} if self.backends is None else dict(self.backends)

    def add(self, backend: Backend) -> None:
        self.backends[backend.name] = backend

    def list_all(self) -> tuple[Backend, ...]:
        return tuple(sorted(self.backends.values(), key=lambda backend: backend.name))

    def get_by_name(self, name: str) -> Backend | None:
        return self.backends.get(name)


@dataclass
class InMemoryZoneRepository:
    zones: dict[str, Zone] | None = None

    def __post_init__(self) -> None:
        self.zones = {} if self.zones is None else dict(self.zones)

    def add(self, zone: Zone) -> None:
        self.zones[zone.name] = zone

    def replace_for_backend(self, backend_name: str, zones: Iterable[Zone]) -> tuple[Zone, ...]:
        retained = {
            name: zone for name, zone in self.zones.items() if zone.backend_name != backend_name
        }
        synchronized = {zone.name: zone for zone in zones if zone.backend_name == backend_name}
        retained.update(synchronized)
        self.zones = retained
        return tuple(sorted(synchronized.values(), key=lambda zone: zone.name))

    def list_all(self) -> tuple[Zone, ...]:
        return tuple(sorted(self.zones.values(), key=lambda zone: zone.name))

    def get_by_name(self, name: str) -> Zone | None:
        return self.zones.get(name)


@dataclass
class InMemoryPermissionGrantRepository:
    grants: dict[tuple[str, str], PermissionGrant] | None = None

    def __post_init__(self) -> None:
        self.grants = {} if self.grants is None else dict(self.grants)

    def upsert(self, grant: PermissionGrant) -> None:
        self.grants[(grant.username, grant.zone_name)] = grant

    def list_for_user(self, username: str) -> tuple[PermissionGrant, ...]:
        matches = [
            grant
            for (grant_username, _zone_name), grant in self.grants.items()
            if grant_username == username
        ]
        return tuple(sorted(matches, key=lambda grant: grant.zone_name))


class DatabaseBackendRepository:
    def __init__(
        self,
        database_url: str,
        connect_fn: Callable[[str | None], object] = connect,
    ) -> None:
        self.database_url = database_url
        self.connect_fn = connect_fn

    def add(self, backend: Backend) -> None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO backends (name, backend_type, capabilities)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (name) DO UPDATE
                    SET backend_type = EXCLUDED.backend_type,
                        capabilities = EXCLUDED.capabilities
                    """,
                    (
                        backend.name,
                        backend.backend_type,
                        [capability.value for capability in backend.capabilities],
                    ),
                )
            connection.commit()

    def list_all(self) -> tuple[Backend, ...]:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT name, backend_type, capabilities
                    FROM backends
                    ORDER BY name
                    """
                )
                rows = cursor.fetchall()

        return tuple(self._map_backend(row) for row in rows)

    def get_by_name(self, name: str) -> Backend | None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT name, backend_type, capabilities
                    FROM backends
                    WHERE name = %s
                    """,
                    (name,),
                )
                row = cursor.fetchone()

        return None if row is None else self._map_backend(row)

    @staticmethod
    def _map_backend(row: tuple[object, object, object]) -> Backend:
        capabilities = tuple(BackendCapability(str(value)) for value in (row[2] or []))
        return Backend(
            name=str(row[0]),
            backend_type=str(row[1]),
            capabilities=capabilities,
        )


class DatabaseZoneRepository:
    def __init__(
        self,
        database_url: str,
        connect_fn: Callable[[str | None], object] = connect,
    ) -> None:
        self.database_url = database_url
        self.connect_fn = connect_fn

    def add(self, zone: Zone) -> None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO zones (name, backend_name)
                    VALUES (%s, %s)
                    ON CONFLICT (name) DO UPDATE
                    SET backend_name = EXCLUDED.backend_name
                    """,
                    (zone.name, zone.backend_name),
                )
            connection.commit()

    def replace_for_backend(self, backend_name: str, zones: Iterable[Zone]) -> tuple[Zone, ...]:
        synchronized_zones = tuple(
            sorted(
                (zone for zone in zones if zone.backend_name == backend_name),
                key=lambda zone: zone.name,
            )
        )

        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                zone_names = [zone.name for zone in synchronized_zones]
                if zone_names:
                    cursor.execute(
                        """
                        DELETE FROM zones
                        WHERE backend_name = %s
                          AND NOT (name = ANY(%s))
                        """,
                        (backend_name, zone_names),
                    )
                else:
                    cursor.execute(
                        "DELETE FROM zones WHERE backend_name = %s",
                        (backend_name,),
                    )

                for zone in synchronized_zones:
                    cursor.execute(
                        """
                        INSERT INTO zones (name, backend_name)
                        VALUES (%s, %s)
                        ON CONFLICT (name) DO UPDATE
                        SET backend_name = EXCLUDED.backend_name
                        """,
                        (zone.name, zone.backend_name),
                    )

            connection.commit()

        return synchronized_zones

    def list_all(self) -> tuple[Zone, ...]:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT name, backend_name
                    FROM zones
                    ORDER BY name
                    """
                )
                rows = cursor.fetchall()

        return tuple(Zone(name=str(row[0]), backend_name=str(row[1])) for row in rows)

    def get_by_name(self, name: str) -> Zone | None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT name, backend_name
                    FROM zones
                    WHERE name = %s
                    """,
                    (name,),
                )
                row = cursor.fetchone()

        return None if row is None else Zone(name=str(row[0]), backend_name=str(row[1]))


class DatabasePermissionGrantRepository:
    def __init__(
        self,
        database_url: str,
        connect_fn: Callable[[str | None], object] = connect,
    ) -> None:
        self.database_url = database_url
        self.connect_fn = connect_fn

    def upsert(self, grant: PermissionGrant) -> None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO permission_grants (username, zone_name, actions)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (username, zone_name) DO UPDATE
                    SET actions = EXCLUDED.actions
                    """,
                    (
                        grant.username,
                        grant.zone_name,
                        [action.value for action in grant.actions],
                    ),
                )
            connection.commit()

    def list_for_user(self, username: str) -> tuple[PermissionGrant, ...]:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT username, zone_name, actions
                    FROM permission_grants
                    WHERE username = %s
                    ORDER BY zone_name
                    """,
                    (username,),
                )
                rows = cursor.fetchall()

        return tuple(
            PermissionGrant(
                username=str(row[0]),
                zone_name=str(row[1]),
                actions=tuple(ZoneAction(str(action)) for action in (row[2] or [])),
            )
            for row in rows
        )


class AccessService:
    def __init__(
        self,
        user_repository: UserRepository,
        backend_repository: BackendRepository,
        zone_repository: ZoneRepository,
        grant_repository: PermissionGrantRepository,
        policy_evaluator: PolicyEvaluator | None = None,
    ) -> None:
        self.user_repository = user_repository
        self.backend_repository = backend_repository
        self.zone_repository = zone_repository
        self.grant_repository = grant_repository
        self.policy_evaluator = policy_evaluator or PolicyEvaluator()

    def register_backend(self, backend: Backend) -> Backend:
        self.backend_repository.add(backend)
        return backend

    def register_zone(self, zone: Zone) -> Zone:
        if self.backend_repository.get_by_name(zone.backend_name) is None:
            raise ValueError(f"backend '{zone.backend_name}' is not registered")
        self.zone_repository.add(zone)
        return zone

    def sync_backend_zones(self, backend_name: str, zones: Iterable[Zone]) -> tuple[Zone, ...]:
        if self.backend_repository.get_by_name(backend_name) is None:
            raise ValueError(f"backend '{backend_name}' is not registered")

        normalized_zones = tuple(Zone(name=zone.name, backend_name=backend_name) for zone in zones)
        return self.zone_repository.replace_for_backend(backend_name, normalized_zones)

    def assign_zone_grant(
        self,
        username: str,
        zone_name: str,
        actions: Iterable[ZoneAction],
    ) -> PermissionGrant:
        user = self.user_repository.get_by_username(username)
        if user is None:
            raise ValueError(f"user '{username}' does not exist")
        if user.role == Role.ADMIN:
            raise ValueError("admin users do not require zone-level grants")

        zone = self.zone_repository.get_by_name(zone_name)
        if zone is None:
            raise ValueError(f"zone '{zone_name}' is not registered")

        normalized_actions = self._normalize_actions(tuple(actions))
        grant = PermissionGrant(
            username=username,
            zone_name=zone.name,
            actions=normalized_actions,
        )
        self.grant_repository.upsert(grant)
        return grant

    def list_accessible_zones(self, user: User) -> tuple[Zone, ...]:
        zones = self.zone_repository.list_all()
        if user.role == Role.ADMIN:
            return zones

        grants = self.grant_repository.list_for_user(user.username)
        accessible_zones = [
            zone
            for zone in zones
            if self.policy_evaluator.is_zone_action_allowed(
                user=user,
                zone_name=zone.name,
                action=ZoneAction.READ,
                grants=grants,
            ).allowed
        ]
        return tuple(accessible_zones)

    def list_accessible_backends(self, user: User) -> tuple[Backend, ...]:
        if user.role == Role.ADMIN:
            return self.backend_repository.list_all()

        accessible_backend_names = {zone.backend_name for zone in self.list_accessible_zones(user)}
        return tuple(
            backend
            for backend in self.backend_repository.list_all()
            if backend.name in accessible_backend_names
        )

    def list_zone_grants_for_user(self, username: str) -> tuple[PermissionGrant, ...]:
        return self.grant_repository.list_for_user(username)

    @staticmethod
    def _normalize_actions(actions: tuple[ZoneAction, ...]) -> tuple[ZoneAction, ...]:
        if not actions:
            raise ValueError("zone grant must include at least one action")

        deduplicated = set(actions)
        if ZoneAction.GRANT in deduplicated:
            deduplicated.update((ZoneAction.READ, ZoneAction.WRITE))
        elif ZoneAction.WRITE in deduplicated:
            deduplicated.add(ZoneAction.READ)

        ordered_actions = tuple(
            action
            for action in (ZoneAction.READ, ZoneAction.WRITE, ZoneAction.GRANT)
            if action in deduplicated
        )
        return ordered_actions
