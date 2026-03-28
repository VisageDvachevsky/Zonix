from enum import StrEnum
from ipaddress import IPv4Address, IPv6Address
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Role(StrEnum):
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


class IdentityProviderKind(StrEnum):
    OIDC = "oidc"


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


class RecordType(StrEnum):
    A = "A"
    AAAA = "AAAA"
    CNAME = "CNAME"
    MX = "MX"
    TXT = "TXT"
    SRV = "SRV"
    NS = "NS"
    PTR = "PTR"
    CAA = "CAA"
    SOA = "SOA"


class ChangeOperation(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


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
    kind: IdentityProviderKind
    issuer: str = Field(min_length=1)
    client_id: str = Field(min_length=1, alias="clientId")
    client_secret: str = Field(min_length=1, alias="clientSecret")
    scopes: tuple[str, ...] = ()
    claims_mapping_rules: dict[str, object] = Field(
        default_factory=dict,
        alias="claimsMappingRules",
    )

    @field_validator("scopes", mode="before")
    @classmethod
    def normalize_scopes(cls, value: object) -> tuple[str, ...]:
        if value is None:
            return ()
        if not isinstance(value, (list, tuple)):
            raise ValueError("scopes must be an array")

        normalized: list[str] = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise ValueError("scopes must not contain empty values")
            scope = item.strip()
            if scope not in normalized:
                normalized.append(scope)
        return tuple(normalized)

    @field_validator("claims_mapping_rules")
    @classmethod
    def require_claim_mapping_rules_object(
        cls, value: dict[str, object]
    ) -> dict[str, object]:
        if not isinstance(value, dict):
            raise ValueError("claims mapping rules must be an object")
        return value

    @model_validator(mode="after")
    def validate_oidc_requirements(self) -> "IdentityProvider":
        if self.kind == IdentityProviderKind.OIDC and not self.scopes:
            raise ValueError("oidc identity providers must define at least one scope")
        return self


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

    @field_validator("record_type", mode="before")
    @classmethod
    def normalize_record_type(cls, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("record_type must not be empty")
        return value.strip().upper()

    @field_validator("values")
    @classmethod
    def require_values(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if not values:
            raise ValueError("values must include at least one item")
        return values

    @model_validator(mode="after")
    def validate_record_values(self) -> "RecordSet":
        validators = {
            RecordType.A.value: self._validate_a_values,
            RecordType.AAAA.value: self._validate_aaaa_values,
            RecordType.CNAME.value: self._validate_single_domain_value,
            RecordType.MX.value: self._validate_mx_values,
            RecordType.TXT.value: self._validate_txt_values,
            RecordType.SRV.value: self._validate_srv_values,
            RecordType.NS.value: self._validate_single_domain_value,
            RecordType.PTR.value: self._validate_single_domain_value,
            RecordType.CAA.value: self._validate_caa_values,
            RecordType.SOA.value: self._validate_soa_values,
        }

        validator = validators.get(self.record_type)
        if validator is not None:
            validator()
        return self

    def _validate_a_values(self) -> None:
        for value in self.values:
            try:
                IPv4Address(value)
            except ValueError as error:
                raise ValueError(f"invalid A record value: {value}") from error

    def _validate_aaaa_values(self) -> None:
        for value in self.values:
            try:
                IPv6Address(value)
            except ValueError as error:
                raise ValueError(f"invalid AAAA record value: {value}") from error

    def _validate_single_domain_value(self) -> None:
        if len(self.values) != 1:
            raise ValueError(f"{self.record_type} record must contain exactly one value")
        self._require_domain_like(self.values[0], self.record_type)

    def _validate_mx_values(self) -> None:
        for value in self.values:
            priority, exchange = self._split_fields(value, expected_parts=2, record_type="MX")
            self._require_uint16(priority, "MX priority")
            self._require_domain_like(exchange, "MX exchange")

    def _validate_txt_values(self) -> None:
        for value in self.values:
            if not value:
                raise ValueError("TXT record values must not be empty")

    def _validate_srv_values(self) -> None:
        for value in self.values:
            priority, weight, port, target = self._split_fields(
                value,
                expected_parts=4,
                record_type="SRV",
            )
            self._require_uint16(priority, "SRV priority")
            self._require_uint16(weight, "SRV weight")
            self._require_uint16(port, "SRV port")
            self._require_domain_like(target, "SRV target")

    def _validate_caa_values(self) -> None:
        for value in self.values:
            flag, tag, caa_value = self._split_fields(value, expected_parts=3, record_type="CAA")
            flag_value = self._require_uint8(flag, "CAA flag")
            if tag.lower() not in {"issue", "issuewild", "iodef"}:
                raise ValueError(f"invalid CAA tag: {tag}")
            if not caa_value:
                raise ValueError("CAA value must not be empty")
            if flag_value not in {0, 128} and flag_value > 255:
                raise ValueError(f"invalid CAA flag: {flag}")

    def _validate_soa_values(self) -> None:
        if len(self.values) != 1:
            raise ValueError("SOA record must contain exactly one value")
        primary_ns, contact, serial, refresh, retry, expire, minimum = self._split_fields(
            self.values[0],
            expected_parts=7,
            record_type="SOA",
        )
        self._require_domain_like(primary_ns, "SOA primary NS")
        self._require_domain_like(contact, "SOA contact")
        for raw_value, label in (
            (serial, "SOA serial"),
            (refresh, "SOA refresh"),
            (retry, "SOA retry"),
            (expire, "SOA expire"),
            (minimum, "SOA minimum"),
        ):
            self._require_uint32(raw_value, label)

    @staticmethod
    def _split_fields(value: str, *, expected_parts: int, record_type: str) -> tuple[str, ...]:
        parts = tuple(item for item in value.split() if item)
        if len(parts) != expected_parts:
            raise ValueError(
                f"{record_type} record value must contain exactly {expected_parts} fields"
            )
        return parts

    @staticmethod
    def _require_domain_like(value: str, field_name: str) -> None:
        if not value or value.isspace():
            raise ValueError(f"{field_name} must not be empty")

    @staticmethod
    def _require_uint8(value: str, field_name: str) -> int:
        parsed = int(value)
        if parsed < 0 or parsed > 255:
            raise ValueError(f"{field_name} must be between 0 and 255")
        return parsed

    @staticmethod
    def _require_uint16(value: str, field_name: str) -> int:
        parsed = int(value)
        if parsed < 0 or parsed > 65535:
            raise ValueError(f"{field_name} must be between 0 and 65535")
        return parsed

    @staticmethod
    def _require_uint32(value: str, field_name: str) -> int:
        parsed = int(value)
        if parsed < 0 or parsed > 4294967295:
            raise ValueError(f"{field_name} must be between 0 and 4294967295")
        return parsed


class ChangeSet(BaseModel):
    model_config = ConfigDict(frozen=True)

    actor: str = Field(min_length=1)
    zone_name: str = Field(min_length=1)
    backend_name: str = Field(min_length=1)
    operation: ChangeOperation
    before: RecordSet | None = None
    after: RecordSet | None = None
    expected_version: str | None = Field(default=None, min_length=1)
    current_version: str | None = Field(default=None, min_length=1)
    has_conflict: bool = False
    conflict_reason: str | None = Field(default=None, min_length=1)
    summary: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_change_bounds(self) -> "ChangeSet":
        if self.before is None and self.after is None and not self.has_conflict:
            raise ValueError("changeset must include before or after state")
        return self


class AuditEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    actor: str = Field(min_length=1)
    action: str = Field(min_length=1)
    zone_name: str | None = Field(default=None, min_length=1)
    backend_name: str | None = Field(default=None, min_length=1)
    payload: dict[str, object] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
