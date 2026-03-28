from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from json import dumps
from typing import Protocol

from app.access import AccessService
from app.domain.models import (
    BackendCapability,
    ChangeOperation,
    ChangeSet,
    RecordSet,
    User,
    ZoneAction,
)
from app.zone_reads import ZoneAdapterNotConfiguredError, ZoneNotFoundError, ZoneReadService


class RecordWriteError(RuntimeError):
    """Base error for adapter-backed record writes."""


class RecordWritePermissionError(RecordWriteError):
    def __init__(self, zone_name: str) -> None:
        super().__init__(f"write access to zone '{zone_name}' is not allowed")
        self.zone_name = zone_name


class RecordWriteNotSupportedError(RecordWriteError):
    def __init__(self, backend_name: str) -> None:
        super().__init__(f"backend '{backend_name}' does not support record writes")
        self.backend_name = backend_name


class RecordAlreadyExistsError(RecordWriteError):
    def __init__(self, zone_name: str, name: str, record_type: str) -> None:
        super().__init__(f"record '{name}' {record_type} already exists in zone '{zone_name}'")


class RecordNotFoundError(RecordWriteError):
    def __init__(self, zone_name: str, name: str, record_type: str) -> None:
        super().__init__(f"record '{name}' {record_type} was not found in zone '{zone_name}'")


class RecordVersionConflictError(RecordWriteError):
    def __init__(
        self,
        zone_name: str,
        name: str,
        record_type: str,
        expected_version: str | None,
        current_version: str | None,
    ) -> None:
        super().__init__(
            f"record '{name}' {record_type} version conflict in zone '{zone_name}': "
            f"expected {expected_version!r}, current {current_version!r}"
        )
        self.zone_name = zone_name
        self.name = name
        self.record_type = record_type
        self.expected_version = expected_version
        self.current_version = current_version


class RecordWriteAdapter(Protocol):
    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]: ...

    def create_record_set(self, record_set: RecordSet) -> RecordSet: ...

    def update_record_set(self, record_set: RecordSet) -> RecordSet: ...

    def delete_record_set(self, zone_name: str, name: str, record_type: str) -> None: ...


@dataclass(frozen=True)
class RecordMutationResult:
    backend_name: str
    record: RecordSet
    change_set: ChangeSet


def record_version(record: RecordSet | None) -> str | None:
    if record is None:
        return None

    payload = {
        "zoneName": record.zone_name,
        "name": record.name,
        "recordType": record.record_type,
        "ttl": record.ttl,
        "values": list(record.values),
    }
    raw_payload = dumps(payload, sort_keys=True, separators=(",", ":"))
    return sha256(raw_payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class RecordChangeContext:
    backend_name: str
    adapter: RecordWriteAdapter
    existing_record: RecordSet | None


class RecordWriteService:
    def __init__(
        self,
        access_service: AccessService,
        zone_read_service: ZoneReadService,
        adapters: Mapping[str, RecordWriteAdapter],
    ) -> None:
        self.access_service = access_service
        self.zone_read_service = zone_read_service
        self.adapters = dict(adapters)

    def preview_create_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> ChangeSet:
        context = self._get_change_context(
            user,
            zone_name=record_set.zone_name,
            name=record_set.name,
            record_type=record_set.record_type,
        )
        conflict_reason = self._resolve_preview_conflict(
            operation=ChangeOperation.CREATE,
            expected_version=expected_version,
            current_version=record_version(context.existing_record),
            existing_record=context.existing_record,
            enforce_version=enforce_version,
        )
        return self._build_change_set(
            actor=user.username,
            backend_name=context.backend_name,
            operation=ChangeOperation.CREATE,
            before=context.existing_record,
            after=record_set,
            expected_version=expected_version,
            conflict_reason=conflict_reason,
        )

    def preview_update_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> ChangeSet:
        context = self._get_change_context(
            user,
            zone_name=record_set.zone_name,
            name=record_set.name,
            record_type=record_set.record_type,
        )
        conflict_reason = self._resolve_preview_conflict(
            operation=ChangeOperation.UPDATE,
            expected_version=expected_version,
            current_version=record_version(context.existing_record),
            existing_record=context.existing_record,
            enforce_version=enforce_version,
        )
        return self._build_change_set(
            actor=user.username,
            backend_name=context.backend_name,
            operation=ChangeOperation.UPDATE,
            before=context.existing_record,
            after=record_set,
            expected_version=expected_version,
            conflict_reason=conflict_reason,
        )

    def preview_delete_record(
        self,
        user: User,
        *,
        zone_name: str,
        name: str,
        record_type: str,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> ChangeSet:
        normalized_record_type = record_type.upper()
        context = self._get_change_context(
            user,
            zone_name=zone_name,
            name=name,
            record_type=normalized_record_type,
        )
        conflict_reason = self._resolve_preview_conflict(
            operation=ChangeOperation.DELETE,
            expected_version=expected_version,
            current_version=record_version(context.existing_record),
            existing_record=context.existing_record,
            enforce_version=enforce_version,
        )
        return self._build_change_set(
            actor=user.username,
            backend_name=context.backend_name,
            operation=ChangeOperation.DELETE,
            before=context.existing_record,
            after=None,
            expected_version=expected_version,
            conflict_reason=conflict_reason,
            zone_name=zone_name,
            name=name,
            record_type=normalized_record_type,
        )

    def create_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> RecordMutationResult:
        change_set = self.preview_create_record(
            user,
            record_set,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        if change_set.current_version is not None and enforce_version:
            raise RecordVersionConflictError(
                record_set.zone_name,
                record_set.name,
                record_set.record_type,
                expected_version,
                change_set.current_version,
            )
        if change_set.current_version is not None:
            raise RecordAlreadyExistsError(
                record_set.zone_name,
                record_set.name,
                record_set.record_type,
            )
        adapter = self._get_adapter(change_set.backend_name)
        record = adapter.create_record_set(record_set)
        applied_change_set = change_set.model_copy(update={"after": record})
        return RecordMutationResult(
            backend_name=change_set.backend_name,
            record=record,
            change_set=applied_change_set,
        )

    def update_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> RecordMutationResult:
        change_set = self.preview_update_record(
            user,
            record_set,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        if change_set.before is None:
            raise RecordNotFoundError(
                record_set.zone_name,
                record_set.name,
                record_set.record_type,
            )
        if enforce_version and change_set.has_conflict:
            raise RecordVersionConflictError(
                record_set.zone_name,
                record_set.name,
                record_set.record_type,
                expected_version,
                change_set.current_version,
            )
        adapter = self._get_adapter(change_set.backend_name)
        record = adapter.update_record_set(record_set)
        applied_change_set = change_set.model_copy(update={"after": record})
        return RecordMutationResult(
            backend_name=change_set.backend_name,
            record=record,
            change_set=applied_change_set,
        )

    def delete_record(
        self,
        user: User,
        zone_name: str,
        name: str,
        record_type: str,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> RecordMutationResult:
        normalized_record_type = record_type.upper()
        change_set = self.preview_delete_record(
            user,
            zone_name=zone_name,
            name=name,
            record_type=normalized_record_type,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        if change_set.before is None:
            raise RecordNotFoundError(zone_name, name, normalized_record_type)
        if enforce_version and change_set.has_conflict:
            raise RecordVersionConflictError(
                zone_name,
                name,
                normalized_record_type,
                expected_version,
                change_set.current_version,
            )
        adapter = self._get_adapter(change_set.backend_name)
        adapter.delete_record_set(zone_name, name, normalized_record_type)
        assert change_set.before is not None
        return RecordMutationResult(
            backend_name=change_set.backend_name,
            record=change_set.before,
            change_set=change_set,
        )

    def _get_change_context(
        self,
        user: User,
        *,
        zone_name: str,
        name: str,
        record_type: str,
    ) -> RecordChangeContext:
        backend_name = self._require_write_access(user, zone_name)
        adapter = self._get_adapter(backend_name)
        existing_record = self._find_existing_record_by_identity(
            adapter.list_records(zone_name),
            name=name,
            record_type=record_type.upper(),
        )
        return RecordChangeContext(
            backend_name=backend_name,
            adapter=adapter,
            existing_record=existing_record,
        )

    def _resolve_preview_conflict(
        self,
        *,
        operation: ChangeOperation,
        expected_version: str | None,
        current_version: str | None,
        existing_record: RecordSet | None,
        enforce_version: bool,
    ) -> str | None:
        if enforce_version and expected_version != current_version:
            return "version mismatch"
        if operation == ChangeOperation.CREATE and existing_record is not None:
            return "record already exists"
        if operation in {ChangeOperation.UPDATE, ChangeOperation.DELETE} and existing_record is None:
            return "record not found"
        return None

    def _build_change_set(
        self,
        *,
        actor: str,
        backend_name: str,
        operation: ChangeOperation,
        before: RecordSet | None,
        after: RecordSet | None,
        expected_version: str | None,
        conflict_reason: str | None,
        zone_name: str | None = None,
        name: str | None = None,
        record_type: str | None = None,
    ) -> ChangeSet:
        effective_zone_name = zone_name
        if effective_zone_name is None and before is not None:
            effective_zone_name = before.zone_name
        if effective_zone_name is None and after is not None:
            effective_zone_name = after.zone_name
        if effective_zone_name is None:
            raise ValueError("changeset zone name could not be resolved")

        effective_name = name
        if effective_name is None and before is not None:
            effective_name = before.name
        if effective_name is None and after is not None:
            effective_name = after.name
        effective_record_type = record_type
        if effective_record_type is None and before is not None:
            effective_record_type = before.record_type
        if effective_record_type is None and after is not None:
            effective_record_type = after.record_type
        if effective_name is None or effective_record_type is None:
            raise ValueError("changeset record identity could not be resolved")

        return ChangeSet(
            actor=actor,
            zone_name=effective_zone_name,
            backend_name=backend_name,
            operation=operation,
            before=before,
            after=after,
            expected_version=expected_version,
            current_version=record_version(before),
            has_conflict=conflict_reason is not None,
            conflict_reason=conflict_reason,
            summary=self._build_summary(operation, effective_name, effective_record_type),
        )

    @staticmethod
    def _build_summary(operation: ChangeOperation, name: str, record_type: str) -> str:
        if operation == ChangeOperation.CREATE:
            return f"Create {name} {record_type}"
        if operation == ChangeOperation.UPDATE:
            return f"Update {name} {record_type}"
        return f"Delete {name} {record_type}"

    def _require_write_access(self, user: User, zone_name: str) -> str:
        zone = self.zone_read_service.get_zone(user, zone_name)
        grants = self.access_service.list_zone_grants_for_user(user.username)
        decision = self.access_service.policy_evaluator.is_zone_action_allowed(
            user=user,
            zone_name=zone_name,
            action=ZoneAction.WRITE,
            grants=grants,
        )
        if not decision.allowed:
            raise RecordWritePermissionError(zone_name)

        backend = self.access_service.backend_repository.get_by_name(zone.backend_name)
        if backend is None or BackendCapability.WRITE_RECORDS not in backend.capabilities:
            raise RecordWriteNotSupportedError(zone.backend_name)
        return zone.backend_name

    def _get_adapter(self, backend_name: str) -> RecordWriteAdapter:
        adapter = self.adapters.get(backend_name)
        if adapter is None:
            raise ZoneAdapterNotConfiguredError(backend_name)
        return adapter

    @staticmethod
    def _find_existing_record(
        records: tuple[RecordSet, ...],
        candidate: RecordSet,
    ) -> RecordSet | None:
        return RecordWriteService._find_existing_record_by_identity(
            records,
            name=candidate.name,
            record_type=candidate.record_type,
        )

    @staticmethod
    def _find_existing_record_by_identity(
        records: tuple[RecordSet, ...],
        *,
        name: str,
        record_type: str,
    ) -> RecordSet | None:
        for record in records:
            if record.name == name and record.record_type == record_type:
                return record
        return None
