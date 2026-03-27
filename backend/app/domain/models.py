from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Role(StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class ZoneAction(StrEnum):
    READ = "read"
    WRITE = "write"
    GRANT = "grant"


class BackendCapability(StrEnum):
    READ_ZONES = "readZones"
    READ_RECORDS = "readRecords"
    WRITE_RECORDS = "writeRecords"
    DISCOVER_ZONES = "discoverZones"
    IMPORT_SNAPSHOT = "importSnapshot"
    COMMENTS_METADATA = "commentsMetadata"
    AXFR = "axfr"
    RFC2136_UPDATE = "rfc2136Update"


class User(BaseModel):
    model_config = ConfigDict(frozen=True)

    username: str = Field(min_length=1)
    role: Role


class PermissionGrant(BaseModel):
    model_config = ConfigDict(frozen=True)

    username: str = Field(min_length=1)
    zone_name: str = Field(min_length=1)
    actions: tuple[ZoneAction, ...]


class IdentityProvider(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    issuer: str = Field(min_length=1)


class Backend(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1)
    backend_type: str = Field(min_length=1)
    capabilities: tuple[BackendCapability, ...]


class Zone(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(min_length=1)
    backend_name: str = Field(min_length=1)


class RecordSet(BaseModel):
    model_config = ConfigDict(frozen=True)

    zone_name: str = Field(min_length=1)
    name: str = Field(min_length=1)
    record_type: str = Field(min_length=1)
    ttl: int = Field(gt=0)
    values: tuple[str, ...]


class ChangeSet(BaseModel):
    model_config = ConfigDict(frozen=True)

    actor: str = Field(min_length=1)
    zone_name: str = Field(min_length=1)
    summary: str = Field(min_length=1)


class AuditEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    actor: str = Field(min_length=1)
    action: str = Field(min_length=1)
    zone_name: str | None = Field(default=None, min_length=1)
    backend_name: str | None = Field(default=None, min_length=1)
