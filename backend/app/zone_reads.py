from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol

from app.access import AccessService
from app.domain.models import Backend, RecordSet, Role, User, Zone


class ZoneReadError(RuntimeError):
    """Base error for adapter-backed zone reads."""


class ZoneAdapterNotConfiguredError(ZoneReadError):
    def __init__(self, backend_name: str) -> None:
        super().__init__(f"backend '{backend_name}' does not have a configured read adapter")
        self.backend_name = backend_name


class ZoneNotFoundError(ZoneReadError):
    def __init__(self, zone_name: str) -> None:
        super().__init__(f"zone '{zone_name}' was not found")
        self.zone_name = zone_name


class UpstreamReadError(ZoneReadError):
    def __init__(self, backend_name: str, message: str) -> None:
        super().__init__(f"backend '{backend_name}' read failed: {message}")
        self.backend_name = backend_name


class ZoneReadAdapter(Protocol):
    def list_zones(self) -> tuple[Zone, ...]: ...

    def get_zone(self, zone_name: str) -> Zone | None: ...

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]: ...


class ZoneReadService:
    def __init__(
        self,
        access_service: AccessService,
        adapters: Mapping[str, ZoneReadAdapter],
    ) -> None:
        self.access_service = access_service
        self.adapters = dict(adapters)

    def list_zones(self, user: User) -> tuple[Zone, ...]:
        return self.access_service.list_accessible_zones(user)

    def get_zone(self, user: User, zone_name: str) -> Zone:
        zone = self._find_accessible_zone(user, zone_name)
        if zone is None:
            raise ZoneNotFoundError(zone_name)
        return zone

    def list_records(self, user: User, zone_name: str) -> tuple[RecordSet, ...]:
        zone = self.get_zone(user, zone_name)
        adapter = self._get_adapter_for_name(zone.backend_name)
        return adapter.list_records(zone.name)

    def list_backend_zones(self, backend_name: str) -> tuple[Zone, ...]:
        adapter = self._get_adapter_for_name(backend_name)
        return adapter.list_zones()

    def configured_backend_names(self) -> tuple[str, ...]:
        return tuple(sorted(self.adapters))

    def _find_accessible_zone(self, user: User, zone_name: str) -> Zone | None:
        granted_zone_names = self._granted_zone_names(user)

        zone = self.access_service.zone_repository.get_by_name(zone_name)
        if zone is not None:
            if granted_zone_names is None or zone.name in granted_zone_names:
                return zone
            return None

        for backend in self.access_service.backend_repository.list_all():
            try:
                adapter = self._get_adapter(backend)
            except ZoneAdapterNotConfiguredError:
                continue

            zone = adapter.get_zone(zone_name)
            if zone is None:
                continue
            if granted_zone_names is None or zone.name in granted_zone_names:
                return zone

        return None

    def _granted_zone_names(self, user: User) -> set[str] | None:
        if user.role == Role.ADMIN:
            return None

        return {
            grant.zone_name
            for grant in self.access_service.list_zone_grants_for_user(user.username)
        }

    def _get_adapter(self, backend: Backend) -> ZoneReadAdapter:
        return self._get_adapter_for_name(backend.name)

    def _get_adapter_for_name(self, backend_name: str) -> ZoneReadAdapter:
        adapter = self.adapters.get(backend_name)
        if adapter is None:
            raise ZoneAdapterNotConfiguredError(backend_name)
        return adapter
