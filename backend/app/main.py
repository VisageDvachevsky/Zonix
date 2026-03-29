from contextlib import asynccontextmanager
from secrets import token_urlsafe
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.access import (
    AccessService,
    DatabaseBackendRepository,
    DatabasePermissionGrantRepository,
    DatabaseZoneRepository,
)
from app.audit import AuditService, DatabaseAuditEventRepository
from app.auth import (
    AuthIdentityConflictError,
    AuthSelfSignupDisabledError,
    AuthService,
    DatabaseUserRepository,
    SessionManager,
    UserRecord,
)
from app.config import settings
from app.database import ping_database
from app.domain.models import (
    Backend,
    BackendCapability,
    ChangeOperation,
    ChangeSet,
    IdentityProvider,
    IdentityProviderKind,
    PermissionGrant,
    RecordSet,
    Role,
    User,
    ZoneAction,
)
from app.identity_providers import DatabaseIdentityProviderRepository, IdentityProviderService
from app.oidc import OIDCExchangeError, OIDCProviderNotFoundError, OIDCService, OIDCStateManager
from app.powerdns import PowerDNSClient, PowerDNSReadAdapter
from app.record_writes import (
    RecordAlreadyExistsError,
    RecordMutationResult,
    RecordNotFoundError,
    RecordVersionConflictError,
    RecordWriteNotSupportedError,
    RecordWritePermissionError,
    RecordWriteService,
    record_version,
)
from app.rfc2136 import RFC2136Adapter, RFC2136Client, build_file_snapshot_readers
from app.schemas import (
    AdminUserListResponse,
    AdminUserResponse,
    AdminUserRoleRequest,
    AuditEventListResponse,
    AuditEventResponse,
    AuthenticatedUserResponse,
    AuthSessionResponse,
    AuthSettingsResponse,
    BackendConfigListResponse,
    BackendConfigRequest,
    BackendListResponse,
    BackendResponse,
    ChangePreviewRequest,
    ChangeSetResponse,
    HealthResponse,
    IdentityProviderConfigListResponse,
    IdentityProviderConfigRequest,
    IdentityProviderConfigResponse,
    LoginRequest,
    OIDCLoginStartResponse,
    OIDCProviderListResponse,
    OIDCProviderResponse,
    ReadinessResponse,
    RecordDeleteRequest,
    RecordListResponse,
    RecordSetRequest,
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
    ZoneReadAdapter,
    ZoneAdapterNotConfiguredError,
    ZoneNotFoundError,
    ZoneReadService,
)


def set_inventory_sync_state(
    app: FastAPI,
    *,
    status: str | None,
    error: str | None,
) -> None:
    app.state.inventory_sync_status = status
    app.state.inventory_sync_error = error


CSRF_COOKIE_NAME = "zonix_csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
ALLOWED_BROWSER_RETURN_ORIGINS = {
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}


def validate_browser_return_to(return_to: str | None) -> str | None:
    if return_to is None:
        return None
    parsed = urlparse(return_to)
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    if origin not in ALLOWED_BROWSER_RETURN_ORIGINS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="return_to origin is not allowed",
        )
    return return_to


def set_auth_cookies(response: Response, session_token: str) -> None:
    csrf_token = token_urlsafe(32)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
        max_age=settings.session_ttl_seconds,
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
        max_age=settings.session_ttl_seconds,
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
    )
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        httponly=False,
        samesite=settings.session_cookie_samesite,
        secure=settings.session_cookie_secure,
        domain=settings.session_cookie_domain,
        path=settings.session_cookie_path,
    )


def enforce_csrf(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if request.url.path == "/auth/login":
        return

    session_token = request.cookies.get(settings.session_cookie_name)
    if session_token is None:
        return

    csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
    csrf_header = request.headers.get(CSRF_HEADER_NAME)
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="csrf token invalid or missing",
        )


def build_auth_service() -> AuthService:
    return AuthService(
        user_repository=DatabaseUserRepository(),
        session_manager=SessionManager(
            secret_key=settings.session_secret_key,
            session_ttl_seconds=settings.session_ttl_seconds,
        ),
    )


def build_identity_provider_service() -> IdentityProviderService:
    return IdentityProviderService(DatabaseIdentityProviderRepository(settings.database_url))


def build_oidc_service(identity_provider_service: IdentityProviderService) -> OIDCService:
    return OIDCService(
        identity_provider_service=identity_provider_service,
        state_manager=OIDCStateManager(secret_key=settings.session_secret_key),
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


def build_zone_adapters() -> dict[str, ZoneReadAdapter]:
    adapters: dict[str, ZoneReadAdapter] = {
        settings.powerdns_backend_name: PowerDNSReadAdapter(
            backend_name=settings.powerdns_backend_name,
            client=PowerDNSClient(
                api_url=settings.powerdns_api_url,
                api_key=settings.powerdns_api_key,
                server_id=settings.powerdns_server_id,
                timeout_seconds=settings.powerdns_timeout_seconds,
            ),
        )
    }

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
    capabilities: list[BackendCapability] = [BackendCapability.READ_ZONES]

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


def build_audit_service(access_service: AccessService) -> AuditService:
    return AuditService(
        repository=DatabaseAuditEventRepository(settings.database_url),
        access_service=access_service,
    )


def record_set_from_request(payload: RecordSetRequest) -> RecordSet:
    return RecordSet(
        zone_name=payload.zone_name,
        name=payload.name,
        record_type=payload.record_type,
        ttl=payload.ttl,
        values=payload.values,
    )


def record_set_from_change_preview(payload: ChangePreviewRequest) -> RecordSet:
    if payload.ttl is None or payload.values is None:
        raise ValueError("create/update preview requires ttl and values")
    return RecordSet(
        zone_name=payload.zone_name,
        name=payload.name,
        record_type=payload.record_type,
        ttl=payload.ttl,
        values=payload.values,
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
    app: FastAPI,
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

    sync_errors: list[str] = []
    try:
        for backend_name in zone_read_service.adapters:
            synchronize_backend_inventory(
                access_service,
                zone_read_service,
                backend_name,
            )
        synchronize_bootstrap_zone_grants(access_service)
    except (UpstreamReadError, ZoneAdapterNotConfiguredError) as error:
        sync_errors.append(str(error))

    if sync_errors:
        set_inventory_sync_state(
            app,
            status="failed",
            error="; ".join(sync_errors),
        )
    else:
        set_inventory_sync_state(
            app,
            status="ok",
            error=None,
        )


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


def get_access_service(request: Request) -> AccessService:
    return request.app.state.access_service


def get_identity_provider_service(request: Request) -> IdentityProviderService:
    return request.app.state.identity_provider_service


def get_zone_read_service(request: Request) -> ZoneReadService:
    return request.app.state.zone_read_service


def get_record_write_service(request: Request) -> RecordWriteService:
    return request.app.state.record_write_service


def get_audit_service(request: Request) -> AuditService:
    return request.app.state.audit_service


def get_oidc_service(request: Request) -> OIDCService:
    return request.app.state.oidc_service


AuthServiceDependency = Annotated[AuthService, Depends(get_auth_service)]
AccessServiceDependency = Annotated[AccessService, Depends(get_access_service)]
IdentityProviderServiceDependency = Annotated[
    IdentityProviderService, Depends(get_identity_provider_service)
]
ZoneReadServiceDependency = Annotated[ZoneReadService, Depends(get_zone_read_service)]
RecordWriteServiceDependency = Annotated[RecordWriteService, Depends(get_record_write_service)]
AuditServiceDependency = Annotated[AuditService, Depends(get_audit_service)]
OIDCServiceDependency = Annotated[OIDCService, Depends(get_oidc_service)]


def audit_payload_from_mutation(mutation: RecordMutationResult) -> dict[str, object]:
    return {
        "name": mutation.record.name,
        "recordType": mutation.record.record_type,
        "ttl": mutation.record.ttl,
        "values": list(mutation.record.values),
        "beforeVersion": mutation.change_set.current_version,
        "afterVersion": record_version(mutation.change_set.after),
    }


def backend_response_from_backend(backend: Backend) -> BackendResponse:
    return BackendResponse(
        name=backend.name,
        backendType=backend.backend_type,
        capabilities=tuple(capability.value for capability in backend.capabilities),
    )


def identity_provider_response_from_provider(
    provider: IdentityProvider,
) -> IdentityProviderConfigResponse:
    return IdentityProviderConfigResponse(
        name=provider.name,
        kind=provider.kind,
        issuer=provider.issuer,
        clientId=provider.client_id,
        scopes=provider.scopes,
        hasClientSecret=bool(provider.client_secret),
        claimsMappingRules=provider.claims_mapping_rules,
    )


def admin_user_response_from_record(user: UserRecord) -> AdminUserResponse:
    return AdminUserResponse(
        username=user.username,
        role=user.role,
        authSource=user.auth_source,
        isActive=user.is_active,
    )


def record_response_from_record(record: RecordSet) -> RecordSetResponse:
    version = record_version(record)
    if version is None:
        raise ValueError("record version must not be empty")
    return RecordSetResponse(
        zoneName=record.zone_name,
        name=record.name,
        recordType=record.record_type,
        ttl=record.ttl,
        values=record.values,
        version=version,
    )


def change_set_response_from_change_set(change_set: ChangeSet) -> ChangeSetResponse:
    return ChangeSetResponse(
        actor=change_set.actor,
        zoneName=change_set.zone_name,
        backendName=change_set.backend_name,
        operation=change_set.operation,
        before=None
        if change_set.before is None
        else record_response_from_record(change_set.before),
        after=None if change_set.after is None else record_response_from_record(change_set.after),
        expectedVersion=change_set.expected_version,
        currentVersion=change_set.current_version,
        hasConflict=change_set.has_conflict,
        conflictReason=change_set.conflict_reason,
        summary=change_set.summary,
    )


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


def authenticated_user_from_request(
    request: Request,
    auth_service: AuthService,
) -> User | None:
    session_token = request.cookies.get(settings.session_cookie_name)
    return auth_service.get_authenticated_user(session_token)


def require_csrf(request: Request) -> None:
    enforce_csrf(request)


CsrfDependency = Annotated[None, Depends(require_csrf)]


def require_admin_user(current_user: CurrentUserDependency) -> AuthenticatedUserResponse:
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin role required")
    return current_user


AdminUserDependency = Annotated[AuthenticatedUserResponse, Depends(require_admin_user)]


def create_app(
    auth_service: AuthService | None = None,
    access_service: AccessService | None = None,
    identity_provider_service: IdentityProviderService | None = None,
    zone_read_service: ZoneReadService | None = None,
    record_write_service: RecordWriteService | None = None,
    audit_service: AuditService | None = None,
    oidc_service: OIDCService | None = None,
) -> FastAPI:
    using_default_runtime = (
        access_service is None
        and identity_provider_service is None
        and zone_read_service is None
        and record_write_service is None
        and audit_service is None
        and oidc_service is None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.using_default_runtime:
            initialize_default_runtime(
                app,
                app.state.access_service,
                app.state.zone_read_service,
            )
        yield

    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

    app.state.auth_service = auth_service or build_auth_service()
    app.state.access_service = access_service or build_access_service()
    app.state.identity_provider_service = (
        identity_provider_service or build_identity_provider_service()
    )
    app.state.zone_read_service = zone_read_service or build_zone_read_service(
        app.state.access_service
    )
    app.state.record_write_service = record_write_service or build_record_write_service(
        app.state.access_service,
        app.state.zone_read_service,
    )
    app.state.audit_service = audit_service or build_audit_service(app.state.access_service)
    app.state.oidc_service = oidc_service or build_oidc_service(app.state.identity_provider_service)
    app.state.using_default_runtime = using_default_runtime
    set_inventory_sync_state(app, status=None, error=None)

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
        inventory_sync_status = app.state.inventory_sync_status
        return HealthResponse(
            status="ok",
            app=settings.app_name,
            version=settings.app_version,
            environment=settings.environment,
            inventorySync=inventory_sync_status,
            inventorySyncError=app.state.inventory_sync_error,
        )

    @app.get("/ready", response_model=ReadinessResponse)
    def ready() -> ReadinessResponse:
        database_ready = ping_database()
        inventory_sync_status = app.state.inventory_sync_status
        status_value = "ok"
        if not database_ready or inventory_sync_status == "failed":
            status_value = "degraded"
        return ReadinessResponse(
            status=status_value,
            database="up" if database_ready else "down",
            inventorySync=inventory_sync_status,
            inventorySyncError=app.state.inventory_sync_error,
        )

    @app.post("/auth/login", response_model=AuthSessionResponse)
    def login(
        payload: LoginRequest,
        response: Response,
        auth_service: AuthServiceDependency,
        audit_service: AuditServiceDependency,
    ) -> AuthSessionResponse:
        user = auth_service.authenticate_local_user(payload.username, payload.password)
        if user is None:
            audit_service.log_event(
                actor=payload.username,
                action="login.failed",
                payload={"authSource": "local"},
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid credentials",
            )

        session_token = auth_service.create_session(user)
        audit_service.log_event(
            actor=user.username,
            action="login.success",
            payload={"role": user.role.value},
        )
        set_auth_cookies(response, session_token)
        return AuthSessionResponse(
            authenticated=True,
            user=AuthenticatedUserResponse(username=user.username, role=user.role),
        )

    @app.post("/auth/logout", response_model=AuthSessionResponse)
    def logout(
        request: Request,
        response: Response,
        _csrf: CsrfDependency,
        auth_service: AuthServiceDependency,
        audit_service: AuditServiceDependency,
    ) -> AuthSessionResponse:
        user = authenticated_user_from_request(request, auth_service)
        if user is not None:
            user_record = auth_service.user_repository.get_by_username(user.username)
            audit_service.log_event(
                actor=user.username,
                action="logout.success",
                payload={"authSource": "local" if user_record is None else user_record.auth_source},
            )
        clear_auth_cookies(response)
        return AuthSessionResponse(authenticated=False, user=None)

    @app.get("/auth/settings", response_model=AuthSettingsResponse)
    def auth_settings(
        identity_provider_service: IdentityProviderServiceDependency,
    ) -> AuthSettingsResponse:
        oidc_enabled = any(
            provider.kind == IdentityProviderKind.OIDC
            for provider in identity_provider_service.list_providers()
        )
        return AuthSettingsResponse(
            localLoginEnabled=True,
            oidcEnabled=oidc_enabled,
            oidcSelfSignupEnabled=settings.auth_oidc_self_signup_enabled,
            csrfEnabled=True,
            sessionCookieName=settings.session_cookie_name,
            sessionCookieSameSite=settings.session_cookie_samesite,
            sessionCookieSecure=settings.session_cookie_secure,
            sessionTtlSeconds=settings.session_ttl_seconds,
            bootstrapAdminEnabled=settings.bootstrap_admin_enabled,
        )

    @app.get("/auth/oidc/providers", response_model=OIDCProviderListResponse)
    def list_oidc_providers(
        identity_provider_service: IdentityProviderServiceDependency,
    ) -> OIDCProviderListResponse:
        providers = tuple(
            provider
            for provider in identity_provider_service.list_providers()
            if provider.kind == IdentityProviderKind.OIDC
        )
        return OIDCProviderListResponse(
            items=tuple(
                OIDCProviderResponse(name=provider.name, kind=provider.kind)
                for provider in providers
            )
        )

    @app.get("/auth/oidc/{provider_name}/login", response_model=OIDCLoginStartResponse)
    def start_oidc_login(
        provider_name: str,
        request: Request,
        oidc_service: OIDCServiceDependency,
        return_to: str | None = None,
    ) -> OIDCLoginStartResponse:
        resolved_return_to = validate_browser_return_to(return_to)
        try:
            login_request = oidc_service.begin_login(
                provider_name=provider_name,
                redirect_uri=str(
                    request.url_for("complete_oidc_login", provider_name=provider_name)
                ),
                return_to=resolved_return_to,
            )
        except OIDCProviderNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except OIDCExchangeError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        return OIDCLoginStartResponse(
            providerName=login_request.provider_name,
            authorizationUrl=login_request.authorization_url,
        )

    @app.get("/auth/oidc/{provider_name}/callback", response_model=AuthSessionResponse)
    def complete_oidc_login(
        provider_name: str,
        code: str,
        state: str,
        request: Request,
        response: Response,
        auth_service: AuthServiceDependency,
        access_service: AccessServiceDependency,
        audit_service: AuditServiceDependency,
        oidc_service: OIDCServiceDependency,
    ) -> AuthSessionResponse:
        return_to: str | None = None
        try:
            state_payload = oidc_service.state_manager.read(state, provider_name)
            raw_return_to = state_payload.get("returnTo")
            if isinstance(raw_return_to, str) and raw_return_to.strip():
                return_to = raw_return_to.strip()
            identity = oidc_service.complete_login(
                provider_name=provider_name,
                code=code,
                state=state,
                redirect_uri=str(
                    request.url_for("complete_oidc_login", provider_name=provider_name)
                ),
            )
            mapping = oidc_service.map_identity(
                provider_name=provider_name,
                identity=identity,
                known_zones=tuple(zone.name for zone in access_service.zone_repository.list_all()),
            )
            user = auth_service.provision_oidc_user(
                username=identity.username,
                role=mapping.role,
                auth_source=f"oidc:{provider_name}",
            )
            if mapping.role == Role.ADMIN:
                access_service.sync_zone_grants_for_user(username=user.username, grants=())
            else:
                access_service.sync_zone_grants_for_user(
                    username=user.username,
                    grants=mapping.grants,
                )
        except OIDCProviderNotFoundError as error:
            audit_service.log_event(
                actor="anonymous",
                action="login.failed",
                payload={"authSource": f"oidc:{provider_name}", "reason": str(error)},
            )
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except AuthIdentityConflictError as error:
            audit_service.log_event(
                actor=error.username,
                action="login.failed",
                payload={"authSource": error.auth_source, "reason": str(error)},
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except AuthSelfSignupDisabledError as error:
            audit_service.log_event(
                actor=error.username,
                action="login.failed",
                payload={"authSource": error.auth_source, "reason": str(error)},
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        except OIDCExchangeError as error:
            audit_service.log_event(
                actor="anonymous",
                action="login.failed",
                payload={"authSource": f"oidc:{provider_name}", "reason": str(error)},
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error
        except RuntimeError as error:
            audit_service.log_event(
                actor="anonymous",
                action="login.failed",
                payload={"authSource": f"oidc:{provider_name}", "reason": str(error)},
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error

        session_token = auth_service.create_session(user)
        audit_service.log_event(
            actor=user.username,
            action="login.success",
            payload={"role": user.role.value, "authSource": f"oidc:{provider_name}"},
        )
        if return_to:
            redirect_response = RedirectResponse(url=return_to, status_code=status.HTTP_303_SEE_OTHER)
            set_auth_cookies(redirect_response, session_token)
            return redirect_response
        set_auth_cookies(response, session_token)
        return AuthSessionResponse(
            authenticated=True,
            user=AuthenticatedUserResponse(username=user.username, role=user.role),
        )

    @app.get("/auth/me", response_model=AuthSessionResponse)
    def me(current_user: CurrentUserDependency) -> AuthSessionResponse:
        return AuthSessionResponse(authenticated=True, user=current_user)

    @app.get("/admin/users", response_model=AdminUserListResponse)
    def list_admin_users(
        _admin_user: AdminUserDependency,
        auth_service: AuthServiceDependency,
    ) -> AdminUserListResponse:
        return AdminUserListResponse(
            items=tuple(admin_user_response_from_record(user) for user in auth_service.list_users())
        )

    @app.put("/admin/users/{username}/role", response_model=AdminUserResponse)
    def update_admin_user_role(
        username: str,
        payload: AdminUserRoleRequest,
        _csrf: CsrfDependency,
        admin_user: AdminUserDependency,
        auth_service: AuthServiceDependency,
        access_service: AccessServiceDependency,
    ) -> AdminUserResponse:
        if username == admin_user.username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cannot change the active session user's global role",
            )
        try:
            user = auth_service.update_user_role(username=username, role=payload.role)
            if payload.role == Role.ADMIN:
                access_service.sync_zone_grants_for_user(username=username, grants=())
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error

        user_record = auth_service.user_repository.get_by_username(user.username)
        assert user_record is not None
        return admin_user_response_from_record(user_record)

    @app.get("/admin/backends", response_model=BackendConfigListResponse)
    def list_admin_backends(
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
    ) -> BackendConfigListResponse:
        return BackendConfigListResponse(
            items=tuple(
                backend_response_from_backend(backend)
                for backend in access_service.backend_repository.list_all()
            )
        )

    @app.post("/admin/backends", response_model=BackendResponse)
    def register_backend_config(
        payload: BackendConfigRequest,
        _csrf: CsrfDependency,
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
    ) -> BackendResponse:
        try:
            backend = access_service.register_backend(
                Backend(
                    name=payload.name,
                    backend_type=payload.backend_type,
                    capabilities=tuple(
                        BackendCapability(capability) for capability in payload.capabilities
                    ),
                )
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error
        return backend_response_from_backend(backend)

    @app.delete("/admin/backends/{backend_name}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_backend_config(
        backend_name: str,
        _csrf: CsrfDependency,
        _admin_user: AdminUserDependency,
        access_service: AccessServiceDependency,
    ) -> Response:
        try:
            access_service.delete_backend(backend_name)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(error),
            ) from error
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/admin/identity-providers", response_model=IdentityProviderConfigListResponse)
    def list_admin_identity_providers(
        _admin_user: AdminUserDependency,
        identity_provider_service: IdentityProviderServiceDependency,
    ) -> IdentityProviderConfigListResponse:
        return IdentityProviderConfigListResponse(
            items=tuple(
                identity_provider_response_from_provider(provider)
                for provider in identity_provider_service.list_providers()
            )
        )

    @app.post("/admin/identity-providers", response_model=IdentityProviderConfigResponse)
    def register_identity_provider_config(
        payload: IdentityProviderConfigRequest,
        _csrf: CsrfDependency,
        _admin_user: AdminUserDependency,
        identity_provider_service: IdentityProviderServiceDependency,
    ) -> IdentityProviderConfigResponse:
        existing_provider = identity_provider_service.get_provider(payload.name)
        client_secret = payload.client_secret
        if client_secret is None:
            if existing_provider is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="clientSecret is required for new identity providers",
                )
            client_secret = existing_provider.client_secret
        try:
            provider = identity_provider_service.register_provider(
                IdentityProvider(
                    name=payload.name,
                    kind=payload.kind,
                    issuer=payload.issuer,
                    clientId=payload.client_id,
                    clientSecret=client_secret,
                    scopes=payload.scopes,
                    claimsMappingRules=payload.claims_mapping_rules,
                )
            )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error
        return identity_provider_response_from_provider(provider)

    @app.delete(
        "/admin/identity-providers/{provider_name}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def delete_identity_provider_config(
        provider_name: str,
        _csrf: CsrfDependency,
        _admin_user: AdminUserDependency,
        identity_provider_service: IdentityProviderServiceDependency,
    ) -> Response:
        deleted = identity_provider_service.delete_provider(provider_name)
        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"identity provider '{provider_name}' is not configured",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/backends", response_model=BackendListResponse)
    def list_backends(
        current_user: CurrentUserDependency,
        access_service: AccessServiceDependency,
    ) -> BackendListResponse:
        backends = access_service.list_accessible_backends(current_user)
        return BackendListResponse(
            items=tuple(backend_response_from_backend(backend) for backend in backends)
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
            items=tuple(record_response_from_record(record) for record in records)
        )

    @app.post("/zones/{zone_name}/changes/preview", response_model=ChangeSetResponse)
    def preview_zone_change(
        zone_name: str,
        payload: ChangePreviewRequest,
        _csrf: CsrfDependency,
        current_user: CurrentUserDependency,
        record_write_service: RecordWriteServiceDependency,
    ) -> ChangeSetResponse:
        if payload.zone_name != zone_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="zone mismatch")

        try:
            if payload.operation == ChangeOperation.CREATE:
                change_set = record_write_service.preview_create_record(
                    User(username=current_user.username, role=current_user.role),
                    record_set_from_change_preview(payload),
                    expected_version=payload.expected_version,
                    enforce_version="expected_version" in payload.model_fields_set,
                )
            elif payload.operation == ChangeOperation.UPDATE:
                change_set = record_write_service.preview_update_record(
                    User(username=current_user.username, role=current_user.role),
                    record_set_from_change_preview(payload),
                    expected_version=payload.expected_version,
                    enforce_version="expected_version" in payload.model_fields_set,
                )
            else:
                change_set = record_write_service.preview_delete_record(
                    User(username=current_user.username, role=current_user.role),
                    zone_name=payload.zone_name,
                    name=payload.name,
                    record_type=payload.record_type,
                    expected_version=payload.expected_version,
                    enforce_version="expected_version" in payload.model_fields_set,
                )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordWritePermissionError as error:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        except RecordWriteNotSupportedError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        return change_set_response_from_change_set(change_set)

    @app.post("/zones/{zone_name}/records", response_model=RecordSetResponse)
    def create_zone_record(
        zone_name: str,
        payload: RecordSetRequest,
        _csrf: CsrfDependency,
        current_user: CurrentUserDependency,
        record_write_service: RecordWriteServiceDependency,
        audit_service: AuditServiceDependency,
    ) -> RecordSetResponse:
        if payload.zone_name != zone_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="zone mismatch")

        try:
            mutation = record_write_service.create_record(
                User(username=current_user.username, role=current_user.role),
                record_set_from_request(payload),
                expected_version=payload.expected_version,
                enforce_version="expected_version" in payload.model_fields_set,
            )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordAlreadyExistsError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except RecordWritePermissionError as error:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        except RecordWriteNotSupportedError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        except RecordVersionConflictError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        audit_service.log_event(
            actor=current_user.username,
            action="record.created",
            zone_name=mutation.record.zone_name,
            backend_name=mutation.backend_name,
            payload=audit_payload_from_mutation(mutation),
        )

        return record_response_from_record(mutation.record)

    @app.put("/zones/{zone_name}/records", response_model=RecordSetResponse)
    def update_zone_record(
        zone_name: str,
        payload: RecordSetRequest,
        _csrf: CsrfDependency,
        current_user: CurrentUserDependency,
        record_write_service: RecordWriteServiceDependency,
        audit_service: AuditServiceDependency,
    ) -> RecordSetResponse:
        if payload.zone_name != zone_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="zone mismatch")

        try:
            mutation = record_write_service.update_record(
                User(username=current_user.username, role=current_user.role),
                record_set_from_request(payload),
                expected_version=payload.expected_version,
                enforce_version="expected_version" in payload.model_fields_set,
            )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordWritePermissionError as error:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        except RecordWriteNotSupportedError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        except RecordVersionConflictError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        audit_service.log_event(
            actor=current_user.username,
            action="record.updated",
            zone_name=mutation.record.zone_name,
            backend_name=mutation.backend_name,
            payload=audit_payload_from_mutation(mutation),
        )

        return record_response_from_record(mutation.record)

    @app.delete("/zones/{zone_name}/records", status_code=status.HTTP_204_NO_CONTENT)
    def delete_zone_record(
        zone_name: str,
        payload: RecordDeleteRequest,
        _csrf: CsrfDependency,
        current_user: CurrentUserDependency,
        record_write_service: RecordWriteServiceDependency,
        audit_service: AuditServiceDependency,
    ) -> Response:
        if payload.zone_name != zone_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="zone mismatch")

        try:
            mutation = record_write_service.delete_record(
                User(username=current_user.username, role=current_user.role),
                zone_name=payload.zone_name,
                name=payload.name,
                record_type=payload.record_type,
                expected_version=payload.expected_version,
                enforce_version="expected_version" in payload.model_fields_set,
            )
        except ZoneNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordNotFoundError as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RecordWritePermissionError as error:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
        except RecordWriteNotSupportedError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        except RecordVersionConflictError as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
        except ZoneAdapterNotConfiguredError as error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error)
            ) from error
        except UpstreamReadError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
            ) from error

        audit_service.log_event(
            actor=current_user.username,
            action="record.deleted",
            zone_name=mutation.record.zone_name,
            backend_name=mutation.backend_name,
            payload=audit_payload_from_mutation(mutation),
        )

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/audit", response_model=AuditEventListResponse)
    def list_audit_events(
        current_user: CurrentUserDependency,
        audit_service: AuditServiceDependency,
        limit: int = 100,
    ) -> AuditEventListResponse:
        events = audit_service.list_events_for_user(
            User(username=current_user.username, role=current_user.role),
            limit=limit,
        )
        return AuditEventListResponse(
            items=tuple(
                AuditEventResponse(
                    actor=event.actor,
                    action=event.action,
                    zoneName=event.zone_name,
                    backendName=event.backend_name,
                    payload=event.payload,
                    createdAt=event.created_at.isoformat(),
                )
                for event in events
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
        _csrf: CsrfDependency,
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
        _csrf: CsrfDependency,
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
