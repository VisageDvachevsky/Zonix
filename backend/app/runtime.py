from __future__ import annotations

from dataclasses import dataclass

from app.access import AccessService
from app.config import settings
from app.domain.models import Backend, BackendCapability, PermissionGrant, ZoneAction
from app.powerdns import PowerDNSClient, PowerDNSReadAdapter
from app.record_writes import RecordWriteService
from app.rfc2136 import RFC2136Adapter, RFC2136Client, build_file_snapshot_readers
from app.zone_reads import UpstreamReadError, ZoneAdapterNotConfiguredError, ZoneReadAdapter, ZoneReadService


@dataclass(frozen=True)
class RuntimeInitializationResult:
    status: str
    error: str | None = None


def build_zone_adapters() -> dict[str, ZoneReadAdapter]:
    adapters: dict[str, ZoneReadAdapter] = {}

    if settings.powerdns_backend_enabled:
        adapters[settings.powerdns_backend_name] = PowerDNSReadAdapter(
            backend_name=settings.powerdns_backend_name,
            client=PowerDNSClient(
                api_url=settings.powerdns_api_url,
                api_key=settings.powerdns_api_key,
                server_id=settings.powerdns_server_id,
                timeout_seconds=settings.powerdns_timeout_seconds,
            ),
        )

    if settings.bind_backend_enabled:
        adapters[settings.bind_backend_name] = RFC2136Adapter(
            backend_name=settings.bind_backend_name,
            zone_names=settings.bind_zone_names,
            client=RFC2136Client(
                server_host=settings.bind_server_host,
                port=settings.bind_server_port,
                timeout_seconds=settings.bind_timeout_seconds,
                tsig_key_name=settings.bind_tsig_key_name,
                tsig_secret=settings.bind_tsig_secret,
                tsig_algorithm=settings.bind_tsig_algorithm,
            ),
            axfr_enabled=settings.bind_axfr_enabled,
            snapshot_readers=build_file_snapshot_readers(settings.bind_snapshot_file_map),
        )

    return adapters


def bind_backend_capabilities() -> tuple[BackendCapability, ...]:
    capabilities: list[BackendCapability] = [
        BackendCapability.DISCOVER_ZONES,
        BackendCapability.READ_ZONES,
    ]

    if settings.bind_axfr_enabled or settings.bind_snapshot_file_map:
        capabilities.append(BackendCapability.READ_RECORDS)
    if settings.bind_snapshot_file_map:
        capabilities.append(BackendCapability.IMPORT_SNAPSHOT)
    if settings.bind_axfr_enabled:
        capabilities.append(BackendCapability.AXFR)
    if settings.bind_tsig_key_name and settings.bind_tsig_secret:
        capabilities.extend(
            (
                BackendCapability.WRITE_RECORDS,
                BackendCapability.RFC2136_UPDATE,
            )
        )

    return tuple(capabilities)


def build_zone_read_service(access_service: AccessService) -> ZoneReadService:
    return ZoneReadService(
        access_service=access_service,
        adapters=build_zone_adapters(),
    )


def build_record_write_service(
    access_service: AccessService,
    zone_read_service: ZoneReadService,
) -> RecordWriteService:
    return RecordWriteService(
        access_service=access_service,
        zone_read_service=zone_read_service,
        adapters=zone_read_service.adapters,
    )


def register_default_backends(access_service: AccessService) -> None:
    if settings.powerdns_backend_enabled:
        access_service.register_backend(
            Backend(
                name=settings.powerdns_backend_name,
                backend_type="powerdns",
                capabilities=(
                    BackendCapability.DISCOVER_ZONES,
                    BackendCapability.READ_ZONES,
                    BackendCapability.READ_RECORDS,
                    BackendCapability.WRITE_RECORDS,
                ),
            )
        )
    if settings.bind_backend_enabled:
        access_service.register_backend(
            Backend(
                name=settings.bind_backend_name,
                backend_type="rfc2136-bind",
                capabilities=bind_backend_capabilities(),
            )
        )


def synchronize_bootstrap_zone_grants(access_service: AccessService) -> None:
    grants_by_user: dict[str, list[PermissionGrant]] = {}
    for grant in settings.bootstrap_zone_grants:
        username = str(grant["username"])
        grants_by_user.setdefault(username, []).append(
            PermissionGrant(
                username=username,
                zone_name=str(grant["zoneName"]),
                actions=tuple(ZoneAction(str(action)) for action in grant["actions"]),
            )
        )
    for username, grants in grants_by_user.items():
        access_service.sync_zone_grants_for_user(username=username, grants=tuple(grants))


def initialize_default_runtime(
    access_service: AccessService,
    zone_read_service: ZoneReadService,
) -> RuntimeInitializationResult:
    register_default_backends(access_service)

    sync_errors: list[str] = []
    try:
        for backend_name in zone_read_service.configured_backend_names():
            zones = zone_read_service.list_backend_zones(backend_name)
            access_service.sync_backend_zones(backend_name, zones)
        synchronize_bootstrap_zone_grants(access_service)
    except (UpstreamReadError, ZoneAdapterNotConfiguredError) as error:
        sync_errors.append(str(error))

    if sync_errors:
        return RuntimeInitializationResult(status="failed", error="; ".join(sync_errors))
    return RuntimeInitializationResult(status="ok")
