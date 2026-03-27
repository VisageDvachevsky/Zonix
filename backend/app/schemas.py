from pydantic import BaseModel, Field

from app.domain.models import Role


class HealthResponse(BaseModel):
    status: str = Field(min_length=1)
    app: str = Field(min_length=1)
    version: str = Field(min_length=1)
    environment: str = Field(min_length=1)


class ReadinessResponse(BaseModel):
    status: str = Field(min_length=1)
    database: str = Field(min_length=1)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class AuthenticatedUserResponse(BaseModel):
    username: str = Field(min_length=1)
    role: Role


class AuthSessionResponse(BaseModel):
    authenticated: bool
    user: AuthenticatedUserResponse | None = None


class BackendResponse(BaseModel):
    name: str = Field(min_length=1)
    backend_type: str = Field(min_length=1, alias="backendType")
    capabilities: tuple[str, ...]


class BackendListResponse(BaseModel):
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


class RecordListResponse(BaseModel):
    items: tuple[RecordSetResponse, ...]


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
