from __future__ import annotations

from dataclasses import dataclass

from app.access import AccessService
from app.audit import AuditService
from app.domain.models import Backend, ChangeOperation, ChangeSet, RecordSet, User, Zone
from app.record_writes import RecordMutationResult, RecordWriteService, record_version
from app.zone_reads import ZoneReadService


def audit_payload_from_mutation(mutation: RecordMutationResult) -> dict[str, object]:
    return {
        "name": mutation.record.name,
        "recordType": mutation.record.record_type,
        "ttl": mutation.record.ttl,
        "values": list(mutation.record.values),
        "beforeVersion": mutation.change_set.current_version,
        "afterVersion": record_version(mutation.change_set.after),
    }


@dataclass(frozen=True)
class BulkRecordChange:
    operation: ChangeOperation
    zone_name: str
    name: str
    record_type: str
    ttl: int | None = None
    values: tuple[str, ...] | None = None
    expected_version: str | None = None
    enforce_version: bool = False


@dataclass(frozen=True)
class BulkChangeResult:
    applied: bool
    changes: tuple[ChangeSet, ...]


@dataclass(frozen=True)
class DiscoveredZone:
    name: str
    backend_name: str
    managed: bool


class ControlPlaneService:
    def __init__(
        self,
        access_service: AccessService,
        zone_read_service: ZoneReadService,
        record_write_service: RecordWriteService,
        audit_service: AuditService,
    ) -> None:
        self.access_service = access_service
        self.zone_read_service = zone_read_service
        self.record_write_service = record_write_service
        self.audit_service = audit_service

    def list_backends(self, user: User) -> tuple[Backend, ...]:
        return self.access_service.list_accessible_backends(user)

    def list_zones(self, user: User) -> tuple[Zone, ...]:
        return self.zone_read_service.list_zones(user)

    def get_zone(self, user: User, zone_name: str) -> Zone:
        return self.zone_read_service.get_zone(user, zone_name)

    def list_records(self, user: User, zone_name: str) -> tuple[RecordSet, ...]:
        return self.zone_read_service.list_records(user, zone_name)

    def preview_change(
        self,
        user: User,
        *,
        operation: ChangeOperation,
        record_set: RecordSet | None = None,
        zone_name: str | None = None,
        name: str | None = None,
        record_type: str | None = None,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> ChangeSet:
        if operation == ChangeOperation.CREATE:
            if record_set is None:
                raise ValueError("record_set is required for create preview")
            return self.record_write_service.preview_create_record(
                user,
                record_set,
                expected_version=expected_version,
                enforce_version=enforce_version,
            )

        if operation == ChangeOperation.UPDATE:
            if record_set is None:
                raise ValueError("record_set is required for update preview")
            return self.record_write_service.preview_update_record(
                user,
                record_set,
                expected_version=expected_version,
                enforce_version=enforce_version,
            )

        if zone_name is None or name is None or record_type is None:
            raise ValueError("zone_name, name, and record_type are required for delete preview")
        return self.record_write_service.preview_delete_record(
            user,
            zone_name=zone_name,
            name=name,
            record_type=record_type,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )

    def create_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> RecordSet:
        mutation = self.record_write_service.create_record(
            user,
            record_set,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        self._log_record_mutation("record.created", mutation)
        return mutation.record

    def update_record(
        self,
        user: User,
        record_set: RecordSet,
        *,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> RecordSet:
        mutation = self.record_write_service.update_record(
            user,
            record_set,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        self._log_record_mutation("record.updated", mutation)
        return mutation.record

    def delete_record(
        self,
        user: User,
        *,
        zone_name: str,
        name: str,
        record_type: str,
        expected_version: str | None = None,
        enforce_version: bool = False,
    ) -> None:
        mutation = self.record_write_service.delete_record(
            user,
            zone_name=zone_name,
            name=name,
            record_type=record_type,
            expected_version=expected_version,
            enforce_version=enforce_version,
        )
        self._log_record_mutation("record.deleted", mutation)

    def sync_backend_zones(self, backend_name: str) -> tuple[Zone, ...]:
        zones = self.zone_read_service.list_backend_zones(backend_name)
        return self.access_service.sync_backend_zones(backend_name, zones)

    def configured_backend_names(self) -> tuple[str, ...]:
        return self.zone_read_service.configured_backend_names()

    def discover_backend_zones(self, backend_name: str) -> tuple[DiscoveredZone, ...]:
        discovered = self.zone_read_service.list_backend_zones(backend_name)
        managed_zone_names = {
            zone.name
            for zone in self.access_service.zone_repository.list_all()
            if zone.backend_name == backend_name
        }
        return tuple(
            DiscoveredZone(
                name=zone.name,
                backend_name=zone.backend_name,
                managed=zone.name in managed_zone_names,
            )
            for zone in discovered
        )

    def import_backend_zones(
        self,
        backend_name: str,
        *,
        zone_names: tuple[str, ...] | None = None,
    ) -> tuple[Zone, ...]:
        discovered = self.discover_backend_zones(backend_name)
        available_zone_names = {zone.name for zone in discovered}

        requested_zone_names = available_zone_names if zone_names is None else set(zone_names)
        unknown_zone_names = sorted(requested_zone_names - available_zone_names)
        if unknown_zone_names:
            raise ValueError(
                f"zones are not discoverable for backend '{backend_name}': "
                + ", ".join(unknown_zone_names)
            )

        imported: list[Zone] = []
        for zone in discovered:
            if zone.name not in requested_zone_names:
                continue
            imported.append(
                self.access_service.register_zone(
                    Zone(name=zone.name, backend_name=zone.backend_name)
                )
            )
        return tuple(sorted(imported, key=lambda zone: zone.name))

    def apply_bulk_changes(
        self,
        user: User,
        *,
        zone_name: str,
        changes: tuple[BulkRecordChange, ...],
    ) -> BulkChangeResult:
        if not changes:
            raise ValueError("bulk change set must include at least one change")

        previews: list[ChangeSet] = []
        seen_record_keys: set[tuple[str, str]] = set()

        for change in changes:
            if change.zone_name != zone_name:
                raise ValueError("bulk change zone mismatch")

            preview = self.preview_change(
                user,
                operation=change.operation,
                record_set=self._record_set_from_bulk_change(change),
                zone_name=change.zone_name,
                name=change.name,
                record_type=change.record_type,
                expected_version=change.expected_version,
                enforce_version=change.enforce_version,
            )
            record_key = (change.name, change.record_type.upper())
            if record_key in seen_record_keys:
                preview = preview.model_copy(
                    update={
                        "has_conflict": True,
                        "conflict_reason": "duplicate record change in bulk set",
                    }
                )
            else:
                seen_record_keys.add(record_key)
            previews.append(preview)

        if any(change.has_conflict for change in previews):
            return BulkChangeResult(applied=False, changes=tuple(previews))

        for change in changes:
            record_set = self._record_set_from_bulk_change(change)
            if change.operation == ChangeOperation.CREATE:
                assert record_set is not None
                self.create_record(
                    user,
                    record_set,
                    expected_version=change.expected_version,
                    enforce_version=change.enforce_version,
                )
            elif change.operation == ChangeOperation.UPDATE:
                assert record_set is not None
                self.update_record(
                    user,
                    record_set,
                    expected_version=change.expected_version,
                    enforce_version=change.enforce_version,
                )
            else:
                self.delete_record(
                    user,
                    zone_name=change.zone_name,
                    name=change.name,
                    record_type=change.record_type,
                    expected_version=change.expected_version,
                    enforce_version=change.enforce_version,
                )

        return BulkChangeResult(applied=True, changes=tuple(previews))

    def _log_record_mutation(self, action: str, mutation: RecordMutationResult) -> None:
        self.audit_service.log_event(
            actor=mutation.change_set.actor,
            action=action,
            zone_name=mutation.record.zone_name,
            backend_name=mutation.backend_name,
            payload=audit_payload_from_mutation(mutation),
        )

    @staticmethod
    def _record_set_from_bulk_change(change: BulkRecordChange) -> RecordSet | None:
        if change.operation == ChangeOperation.DELETE:
            return None
        if change.ttl is None or change.values is None:
            raise ValueError("create/update bulk changes require ttl and values")
        return RecordSet(
            zone_name=change.zone_name,
            name=change.name,
            record_type=change.record_type,
            ttl=change.ttl,
            values=change.values,
        )
