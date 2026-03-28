from pydantic import BaseModel, Field, model_validator

from app.domain.models import ChangeOperation, IdentityProviderKind, Role


class HealthResponse(BaseModel):
    status: str = Field(min_length=1)
    app: str = Field(min_length=1)
    version: str = Field(min_length=1)
    environment: str = Field(min_length=1)
    inventory_sync: str | None = Field(default=None, alias="inventorySync")
    inventory_sync_error: str | None = Field(default=None, alias="inventorySyncError")


class ReadinessResponse(BaseModel):
    status: str = Field(min_length=1)
    database: str = Field(min_length=1)
    inventory_sync: str | None = Field(default=None, alias="inventorySync")
    inventory_sync_error: str | None = Field(default=None, alias="inventorySyncError")


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthenticatedUserResponse(BaseModel):
    username: str = Field(min_length=1)
    role: Role


class AdminUserResponse(BaseModel):
    username: str = Field(min_length=1)
    role: Role
    auth_source: str = Field(min_length=1, alias="authSource")
    is_active: bool = Field(alias="isActive")


class AdminUserListResponse(BaseModel):
    items: tuple[AdminUserResponse, ...]


class AdminUserRoleRequest(BaseModel):
    role: Role


class AuthSessionResponse(BaseModel):
    authenticated: bool
    user: AuthenticatedUserResponse | None = None


class AuthSettingsResponse(BaseModel):
    local_login_enabled: bool = Field(alias="localLoginEnabled")
    oidc_enabled: bool = Field(alias="oidcEnabled")
    oidc_self_signup_enabled: bool = Field(alias="oidcSelfSignupEnabled")
    csrf_enabled: bool = Field(alias="csrfEnabled")
    session_cookie_name: str = Field(min_length=1, alias="sessionCookieName")
    session_cookie_samesite: str = Field(min_length=1, alias="sessionCookieSameSite")
    session_cookie_secure: bool = Field(alias="sessionCookieSecure")
    session_ttl_seconds: int = Field(gt=0, alias="sessionTtlSeconds")
    bootstrap_admin_enabled: bool = Field(alias="bootstrapAdminEnabled")


class OIDCProviderResponse(BaseModel):
    name: str = Field(min_length=1)
    kind: IdentityProviderKind


class OIDCProviderListResponse(BaseModel):
    items: tuple[OIDCProviderResponse, ...]


class OIDCLoginStartResponse(BaseModel):
    provider_name: str = Field(min_length=1, alias="providerName")
    authorization_url: str = Field(min_length=1, alias="authorizationUrl")


class IdentityProviderConfigRequest(BaseModel):
    name: str = Field(min_length=1)
    kind: IdentityProviderKind
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1, alias="clientId")
    client_secret: str | None = Field(default=None, min_length=1, alias="clientSecret")
    scopes: tuple[str, ...] = Field(min_length=1)
    claims_mapping_rules: dict[str, object] = Field(
        default_factory=dict,
        alias="claimsMappingRules",
    )


class IdentityProviderConfigResponse(BaseModel):
    name: str = Field(min_length=1)
    kind: IdentityProviderKind
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1, alias="clientId")
    scopes: tuple[str, ...]
    has_client_secret: bool = Field(alias="hasClientSecret")
    claims_mapping_rules: dict[str, object] = Field(alias="claimsMappingRules")


class IdentityProviderConfigListResponse(BaseModel):
    items: tuple[IdentityProviderConfigResponse, ...]


class BackendResponse(BaseModel):
    name: str = Field(min_length=1)
    backend_type: str = Field(min_length=1, alias="backendType")
    capabilities: tuple[str, ...]


class BackendListResponse(BaseModel):
    items: tuple[BackendResponse, ...]


class BackendConfigRequest(BaseModel):
    name: str = Field(min_length=1)
    backend_type: str = Field(min_length=1, alias="backendType")
    capabilities: tuple[str, ...] = Field(default=())


class BackendConfigListResponse(BaseModel):
    items: tuple[BackendResponse, ...]


class ZoneResponse(BaseModel):
    name: str = Field(min_length=1)
    backend_name: str = Field(min_length=1, alias="backendName")


class ZoneListResponse(BaseModel):
    items: tuple[ZoneResponse, ...]


class RecordSetResponse(BaseModel):
    zone_name: str = Field(min_length=1, alias="zoneName")
    name: str = Field(min_length=1)
    record_type: str = Field(min_length=1, alias="recordType")
    ttl: int = Field(gt=0)
    values: tuple[str, ...]
    version: str = Field(min_length=1)


class RecordListResponse(BaseModel):
    items: tuple[RecordSetResponse, ...]


class RecordSetRequest(BaseModel):
    zone_name: str = Field(min_length=1, alias="zoneName")
    name: str = Field(min_length=1)
    record_type: str = Field(min_length=1, alias="recordType")
    ttl: int = Field(gt=0)
    values: tuple[str, ...] = Field(min_length=1)
    expected_version: str | None = Field(default=None, alias="expectedVersion")


class RecordDeleteRequest(BaseModel):
    zone_name: str = Field(min_length=1, alias="zoneName")
    name: str = Field(min_length=1)
    record_type: str = Field(min_length=1, alias="recordType")
    expected_version: str | None = Field(default=None, alias="expectedVersion")


class ChangePreviewRequest(BaseModel):
    operation: ChangeOperation
    zone_name: str = Field(min_length=1, alias="zoneName")
    name: str = Field(min_length=1)
    record_type: str = Field(min_length=1, alias="recordType")
    ttl: int | None = Field(default=None, gt=0)
    values: tuple[str, ...] | None = None
    expected_version: str | None = Field(default=None, alias="expectedVersion")

    @model_validator(mode="after")
    def validate_operation_shape(self) -> ChangePreviewRequest:
        if self.operation in {ChangeOperation.CREATE, ChangeOperation.UPDATE}:
            if self.ttl is None:
                raise ValueError("ttl is required for create/update preview")
            if not self.values:
                raise ValueError("values are required for create/update preview")
        if self.operation == ChangeOperation.DELETE:
            if self.ttl is not None:
                raise ValueError("ttl is not allowed for delete preview")
            if self.values is not None:
                raise ValueError("values are not allowed for delete preview")
        return self


class ChangeSetResponse(BaseModel):
    actor: str = Field(min_length=1)
    zone_name: str = Field(min_length=1, alias="zoneName")
    backend_name: str = Field(min_length=1, alias="backendName")
    operation: ChangeOperation
    before: RecordSetResponse | None = None
    after: RecordSetResponse | None = None
    expected_version: str | None = Field(default=None, alias="expectedVersion")
    current_version: str | None = Field(default=None, alias="currentVersion")
    has_conflict: bool = Field(alias="hasConflict")
    conflict_reason: str | None = Field(default=None, alias="conflictReason")
    summary: str = Field(min_length=1)


class AuditEventResponse(BaseModel):
    actor: str = Field(min_length=1)
    action: str = Field(min_length=1)
    zone_name: str | None = Field(default=None, alias="zoneName")
    backend_name: str | None = Field(default=None, alias="backendName")
    payload: dict[str, object]
    created_at: str = Field(min_length=1, alias="createdAt")


class AuditEventListResponse(BaseModel):
    items: tuple[AuditEventResponse, ...]


class ZoneGrantRequest(BaseModel):
    username: str = Field(min_length=1)
    zone_name: str = Field(min_length=1, alias="zoneName")
    actions: tuple[str, ...] = Field(min_length=1)


class ZoneGrantResponse(BaseModel):
    username: str = Field(min_length=1)
    zone_name: str = Field(min_length=1, alias="zoneName")
    actions: tuple[str, ...]


class ZoneGrantListResponse(BaseModel):
    items: tuple[ZoneGrantResponse, ...]


class ZoneSyncResponse(BaseModel):
    backend_name: str = Field(min_length=1, alias="backendName")
    synced_zones: tuple[ZoneResponse, ...] = Field(alias="syncedZones")
