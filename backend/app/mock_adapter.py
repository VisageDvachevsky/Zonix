from app.access import (
    AccessService,
    InMemoryBackendRepository,
    InMemoryPermissionGrantRepository,
    InMemoryUserDirectory,
    InMemoryZoneRepository,
)
from app.domain.models import Backend, BackendCapability, Role, User, Zone, ZoneAction


def build_mock_access_service() -> AccessService:
    service = AccessService(
        user_repository=InMemoryUserDirectory(
            users={
                "admin": User(username="admin", role=Role.ADMIN),
                "operator": User(username="operator", role=Role.EDITOR),
                "viewer": User(username="viewer", role=Role.VIEWER),
            }
        ),
        backend_repository=InMemoryBackendRepository(),
        zone_repository=InMemoryZoneRepository(),
        grant_repository=InMemoryPermissionGrantRepository(),
    )

    service.register_backend(
        Backend(
            name="powerdns-sandbox",
            backend_type="powerdns",
            capabilities=(
                BackendCapability.READ_ZONES,
                BackendCapability.READ_RECORDS,
                BackendCapability.WRITE_RECORDS,
            ),
        )
    )
    service.register_backend(
        Backend(
            name="bind-lab",
            backend_type="rfc2136-bind",
            capabilities=(
                BackendCapability.READ_ZONES,
                BackendCapability.AXFR,
                BackendCapability.RFC2136_UPDATE,
            ),
        )
    )

    service.register_zone(Zone(name="example.com", backend_name="powerdns-sandbox"))
    service.register_zone(Zone(name="internal.example", backend_name="powerdns-sandbox"))
    service.register_zone(Zone(name="lab.example", backend_name="bind-lab"))

    service.assign_zone_grant(
        username="operator",
        zone_name="example.com",
        actions=(ZoneAction.WRITE,),
    )
    service.assign_zone_grant(
        username="viewer",
        zone_name="lab.example",
        actions=(ZoneAction.READ,),
    )

    return service
