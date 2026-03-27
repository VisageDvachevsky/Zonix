from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.access import (
    AccessService,
    DatabaseBackendRepository,
    DatabasePermissionGrantRepository,
    DatabaseZoneRepository,
)
from app.auth import AuthService, DatabaseUserRepository, SessionManager
from app.config import settings
from app.database import ping_database
from app.domain.models import Backend, BackendCapability, Role, User, ZoneAction
from app.powerdns import PowerDNSClient, PowerDNSReadAdapter
from app.schemas import (
    AuthenticatedUserResponse,
    AuthSessionResponse,
    BackendListResponse,
    BackendResponse,
    HealthResponse,
    LoginRequest,
    ReadinessResponse,
    RecordListResponse,
    RecordSetResponse,
    ZoneGrantListResponse,
    ZoneGrantRequest,
    ZoneGrantResponse,
    ZoneListResponse,
    ZoneResponse,
    ZoneSyncResponse,
)
from app.zone_reads import (
    UpstreamReadError,
    ZoneAdapterNotConfiguredError,
    ZoneNotFoundError,
    ZoneReadService,
)


def build_auth_service() -> AuthService:
    return AuthService(
        user_repository=DatabaseUserRepository(),
        session_manager=SessionManager(
            secret_key=settings.session_secret_key,
            session_ttl_seconds=settings.session_ttl_seconds,
        ),
    )


class DatabaseAccessUserRepository:
    def __init__(self, database_user_repository: DatabaseUserRepository | None = None) -> None:
        self.database_user_repository = database_user_repository or DatabaseUserRepository()

    def get_by_username(self, username: str) -> User | None:
        user_record = self.database_user_repository.get_by_username(username)
        if user_record is None or not user_record.is_active:
            return None
        return user_record.to_user()


def build_access_service() -> AccessService:
    return AccessService(
        user_repository=DatabaseAccessUserRepository(),
        backend_repository=DatabaseBackendRepository(settings.database_url),
        zone_repository=DatabaseZoneRepository(settings.database_url),
        grant_repository=DatabasePermissionGrantRepository(settings.database_url),
    )


def build_zone_read_service(access_service: AccessService) -> ZoneReadService:
    return ZoneReadService(
        access_service=access_service,
        adapters={
            settings.powerdns_backend_name: PowerDNSReadAdapter(
                backend_name=settings.powerdns_backend_name,
                client=PowerDNSClient(
                    api_url=settings.powerdns_api_url,
                    api_key=settings.powerdns_api_key,
                    server_id=settings.powerdns_server_id,
                    timeout_seconds=settings.powerdns_timeout_seconds,
                ),
            )
        },
    )


def synchronize_backend_inventory(
    access_service: AccessService,
    zone_read_service: ZoneReadService,
    backend_name: str,
) -> tuple[ZoneResponse, ...]:
    adapter = zone_read_service.adapters.get(backend_name)
    if adapter is None:
        raise ZoneAdapterNotConfiguredError(backend_name)

    synchronized = access_service.sync_backend_zones(backend_name, adapter.list_zones())
    return tuple(
        ZoneResponse(name=zone.name, backendName=zone.backend_name) for zone in synchronized
    )


def initialize_default_runtime(
    access_service: AccessService,
    zone_read_service: ZoneReadService,
) -> None:
    access_service.register_backend(
        Backend(
            name=settings.powerdns_backend_name,
            backend_type="powerdns",
            capabilities=(
                BackendCapability.READ_ZONES,
                BackendCapability.READ_RECORDS,
            ),
        )
    )
    try:
        synchronize_backend_inventory(
            access_service,
            zone_read_service,
            settings.powerdns_backend_name,
        )
    except (UpstreamReadError, ZoneAdapterNotConfiguredError):
        pass


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


def get_access_service(request: Request) -> AccessService:
    return request.app.state.access_service


def get_zone_read_service(request: Request) -> ZoneReadService:
    return request.app.state.zone_read_service


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]
AccessServiceDependency = Annotated[AccessService, Depends(get_access_service)]
ZoneReadServiceDependency = Annotated[ZoneReadService, Depends(get_zone_read_service)]


def get_current_user(
    request: Request,
    auth_service: AuthServiceDependency,
) -> AuthenticatedUserResponse:
    session_token = request.cookies.get(settings.session_cookie_name)
    user = auth_service.get_authenticated_user(session_token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    return AuthenticatedUserResponse(username=user.username, role=user.role)


CurrentUserDependency = Annotated[AuthenticatedUserResponse, Depends(get_current_user)]


def require_admin_user(current_user: CurrentUserDependency) -> AuthenticatedUserResponse:
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin role required")
    return current_user


AdminUserDependency = Annotated[AuthenticatedUserResponse, Depends(require_admin_user)]


def create_app(
    auth_service: AuthService | None = None,
    access_service: AccessService | None = None,
    zone_read_service: ZoneReadService | None = None,
) -> FastAPI:
    using_default_runtime = access_service is None and zone_read_service is None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.using_default_runtime:
            initialize_default_runtime(app.state.access_service, app.state.zone_read_service)
        yield

    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

    app.state.auth_service = auth_service or build_auth_service()
    app.state.access_service = access_service or build_access_service()
    app.state.zone_read_service = zone_read_service or build_zone_read_service(
        app.state.access_service
    )
    app.state.using_default_runtime = using_default_runtime

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:4173",
            "http://127.0.0.1:4173",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            app=settings.app_name,
            version=settings.app_version,
            environment=settings.environment,
        )

    @app.get("/ready", response_model=ReadinessResponse)
    def ready() -> ReadinessResponse:
        database_ready = ping_database()
        return ReadinessResponse(
            status="ok" if database_ready else "degraded",
            database="up" if database_ready else "down",
        )

    @app.post("/auth/login", response_model=AuthSessionResponse)
    def login(
        payload: LoginRequest,
        response: Response,
        auth_service: AuthServiceDependency,
    ) -> AuthSessionResponse:
        user = auth_service.authenticate_local_user(payload.username, payload.password)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid credentials",
            )

        session_token = auth_service.create_session(user)
        response.set_cookie(
            key=settings.session_cookie_name,
            value=session_token,
            httponly=True,
            samesite="lax",
            secure=settings.environment != "development",
            max_age=settings.session_ttl_seconds,
        )
        return AuthSessionResponse(
            authenticated=True,
            user=AuthenticatedUserResponse(username=user.username, role=user.role),
        )

    @app.post("/auth/logout", response_model=AuthSessionResponse)
    def logout(response: Response) -> AuthSessionResponse:
        response.delete_cookie(
            key=settings.session_cookie_name,
            httponly=True,
            samesite="lax",
            secure=settings.environment != "development",
        )
        return AuthSessionResponse(authenticated=False, user=None)

    @app.get("/auth/me", response_model=AuthSessionResponse)
    def me(current_user: CurrentUserDependency) -> AuthSessionResponse:
        return AuthSessionResponse(authenticated=True, user=current_user)

    @app.get("/backends", response_model=BackendListResponse)
    def list_backends(
        current_user: CurrentUserDependency,
        access_service: AccessServiceDependency,
    ) -> BackendListResponse:
        backends = access_service.list_accessible_backends(current_user)
        return BackendListResponse(
            items=tuple(
                BackendResponse(
                    name=backend.name,
                    backendType=backend.backend_type,
                    capabilities=tuple(capability.value for capability in backend.capabilities),
                )
                for backend in backends
            )
        )

    @app.get("/zones", response_model=ZoneListResponse)
    def list_zones(
        current_user: CurrentUserDependency,
        zone_read_service: ZoneReadServiceDependency,
    ) -> ZoneListResponse:
        try:
            zones = zone_read_service.list_zones(
                User(username=current_user.username, role=current_user.role)
            )
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error
        return ZoneListResponse(
            items=tuple(
                ZoneResponse(
                    name=zone.name,
                    backendName=zone.backend_name,
                )
                for zone in zones
            )
        )

    @app.get("/zones/{zone_name}", response_model=ZoneResponse)
    def get_zone(
        zone_name: str,
        current_user: CurrentUserDependency,
        zone_read_service: ZoneReadServiceDependency,
    ) -> ZoneResponse:
        try:
            zone = zone_read_service.get_zone(
                User(username=current_user.username, role=current_user.role),
                zone_name=zone_name,
            )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        return ZoneResponse(name=zone.name, backendName=zone.backend_name)

    @app.get("/zones/{zone_name}/records", response_model=RecordListResponse)
    def list_zone_records(
        zone_name: str,
        current_user: CurrentUserDependency,
        zone_read_service: ZoneReadServiceDependency,
    ) -> RecordListResponse:
        try:
            records = zone_read_service.list_records(
                User(username=current_user.username, role=current_user.role),
                zone_name=zone_name,
            )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        return RecordListResponse(
            items=tuple(
                RecordSetResponse(
                    zoneName=record.zone_name,
                    name=record.name,
                    recordType=record.record_type,
                    ttl=record.ttl,
                    values=record.values,
                )
                for record in records
            )
        )

    @app.get("/admin/grants/{username}", response_model=ZoneGrantListResponse)
    def list_zone_grants(
        username: str,
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
    ) -> ZoneGrantListResponse:
        grants = access_service.list_zone_grants_for_user(username)
        return ZoneGrantListResponse(
            items=tuple(
                ZoneGrantResponse(
                    username=grant.username,
                    zoneName=grant.zone_name,
                    actions=tuple(action.value for action in grant.actions),
                )
                for grant in grants
            )
        )

    @app.post("/admin/grants/zones", response_model=ZoneGrantResponse)
    def assign_zone_grant(
        payload: ZoneGrantRequest,
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
    ) -> ZoneGrantResponse:
        try:
            grant = access_service.assign_zone_grant(
                username=payload.username,
                zone_name=payload.zone_name,
                actions=tuple(ZoneAction(action) for action in payload.actions),
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error

        return ZoneGrantResponse(
            username=grant.username,
            zoneName=grant.zone_name,
            actions=tuple(action.value for action in grant.actions),
        )

    @app.post(
        "/admin/backends/{backend_name}/zones/sync",
        response_model=ZoneSyncResponse,
    )
    def sync_backend_zones(
        backend_name: str,
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
        zone_read_service: ZoneReadServiceDependency,
    ) -> ZoneSyncResponse:
        try:
            synchronized = synchronize_backend_inventory(
                access_service,
                zone_read_service,
                backend_name,
            )
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error

        return ZoneSyncResponse(
            backendName=backend_name,
            syncedZones=synchronized,
        )

    return app


app = create_app()
