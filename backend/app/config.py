from dataclasses import dataclass, field
from json import loads
from os import getenv


def env_flag(name: str, default: bool) -> bool:
    raw_value = getenv(name)
    if raw_value is None:
        return default

    normalized = raw_value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean-like value")


def _load_bootstrap_users() -> list[dict[str, object]]:
    raw = getenv("ZONIX_BOOTSTRAP_USERS_JSON", "[]")
    payload = loads(raw)
    if not isinstance(payload, list):
        raise ValueError("ZONIX_BOOTSTRAP_USERS_JSON must decode to an array")
    normalized: list[dict[str, object]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("ZONIX_BOOTSTRAP_USERS_JSON entries must be objects")
        normalized.append(dict(item))
    return normalized


def _load_bootstrap_zone_grants() -> list[dict[str, object]]:
    raw = getenv("ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON", "[]")
    payload = loads(raw)
    if not isinstance(payload, list):
        raise ValueError("ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON must decode to an array")
    normalized: list[dict[str, object]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError(
                "ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON entries must be objects"
            )
        normalized.append(dict(item))
    return normalized


def _load_bind_zone_names() -> tuple[str, ...]:
    raw = getenv("ZONIX_BIND_ZONE_NAMES", "")
    return tuple(zone.strip() for zone in raw.split(",") if zone.strip())


def _load_bind_snapshot_file_map() -> dict[str, str]:
    raw = getenv("ZONIX_BIND_SNAPSHOT_FILE_MAP", "{}")
    payload = loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("ZONIX_BIND_SNAPSHOT_FILE_MAP must decode to an object")

    normalized: dict[str, str] = {}
    for zone_name, path in payload.items():
        if not isinstance(zone_name, str) or not zone_name.strip():
            raise ValueError("ZONIX_BIND_SNAPSHOT_FILE_MAP keys must be non-empty zone names")
        if not isinstance(path, str) or not path.strip():
            raise ValueError("ZONIX_BIND_SNAPSHOT_FILE_MAP values must be non-empty file paths")
        normalized[zone_name.strip()] = path.strip()
    return normalized


@dataclass(frozen=True)
class Settings:
    app_name: str = field(default_factory=lambda: getenv("ZONIX_APP_NAME", "Zonix API"))
    app_version: str = field(default_factory=lambda: getenv("ZONIX_APP_VERSION", "0.1.0"))
    environment: str = field(default_factory=lambda: getenv("ZONIX_ENV", "development"))
    database_url: str = field(
        default_factory=lambda: getenv(
            "ZONIX_DATABASE_URL",
            "postgresql://zonix:zonix@127.0.0.1:55432/zonix",
        )
    )
    bootstrap_admin_username: str = field(
        default_factory=lambda: getenv("ZONIX_BOOTSTRAP_ADMIN_USERNAME", "admin")
    )
    bootstrap_admin_enabled: bool = field(
        default_factory=lambda: env_flag("ZONIX_BOOTSTRAP_ADMIN_ENABLED", True)
    )
    bootstrap_admin_password: str = field(
        default_factory=lambda: getenv(
            "ZONIX_BOOTSTRAP_ADMIN_PASSWORD",
            "local-dev-admin-change-me",
        )
    )
    session_cookie_name: str = field(
        default_factory=lambda: getenv("ZONIX_SESSION_COOKIE_NAME", "zonix_session")
    )
    session_cookie_samesite: str = field(
        default_factory=lambda: getenv("ZONIX_SESSION_COOKIE_SAMESITE", "lax")
    )
    session_cookie_secure: bool = field(
        default_factory=lambda: env_flag("ZONIX_SESSION_COOKIE_SECURE", False)
    )
    session_cookie_domain: str | None = field(
        default_factory=lambda: getenv("ZONIX_SESSION_COOKIE_DOMAIN") or None
    )
    session_cookie_path: str = field(
        default_factory=lambda: getenv("ZONIX_SESSION_COOKIE_PATH", "/")
    )
    session_secret_key: str = field(
        default_factory=lambda: getenv(
            "ZONIX_SESSION_SECRET_KEY",
            "local-dev-session-secret-change-me-32-bytes",
        )
    )
    session_ttl_seconds: int = field(
        default_factory=lambda: int(getenv("ZONIX_SESSION_TTL_SECONDS", str(60 * 60 * 12)))
    )
    auth_oidc_self_signup_enabled: bool = field(
        default_factory=lambda: env_flag("ZONIX_AUTH_OIDC_SELF_SIGNUP_ENABLED", False)
    )
    powerdns_backend_name: str = field(
        default_factory=lambda: getenv("ZONIX_POWERDNS_BACKEND_NAME", "powerdns-local")
    )
    powerdns_api_url: str = field(
        default_factory=lambda: getenv("ZONIX_POWERDNS_API_URL", "http://127.0.0.1:8081")
    )
    powerdns_api_key: str = field(
        default_factory=lambda: getenv("ZONIX_POWERDNS_API_KEY", "zonix-dev-powerdns-key")
    )
    powerdns_server_id: str = field(
        default_factory=lambda: getenv("ZONIX_POWERDNS_SERVER_ID", "localhost")
    )
    powerdns_timeout_seconds: float = field(
        default_factory=lambda: float(getenv("ZONIX_POWERDNS_TIMEOUT_SECONDS", "5"))
    )
    bind_backend_enabled: bool = field(
        default_factory=lambda: env_flag("ZONIX_BIND_BACKEND_ENABLED", False)
    )
    bind_backend_name: str = field(
        default_factory=lambda: getenv("ZONIX_BIND_BACKEND_NAME", "bind-lab")
    )
    bind_server_host: str = field(
        default_factory=lambda: getenv("ZONIX_BIND_SERVER_HOST", "127.0.0.1")
    )
    bind_server_port: int = field(
        default_factory=lambda: int(getenv("ZONIX_BIND_SERVER_PORT", "53"))
    )
    bind_timeout_seconds: float = field(
        default_factory=lambda: float(getenv("ZONIX_BIND_TIMEOUT_SECONDS", "5"))
    )
    bind_axfr_enabled: bool = field(
        default_factory=lambda: env_flag("ZONIX_BIND_AXFR_ENABLED", True)
    )
    bind_tsig_key_name: str = field(
        default_factory=lambda: getenv("ZONIX_BIND_TSIG_KEY_NAME", "")
    )
    bind_tsig_secret: str = field(
        default_factory=lambda: getenv("ZONIX_BIND_TSIG_SECRET", "")
    )
    bind_tsig_algorithm: str = field(
        default_factory=lambda: getenv("ZONIX_BIND_TSIG_ALGORITHM", "hmac-sha256")
    )
    bind_zone_names: tuple[str, ...] = field(default_factory=_load_bind_zone_names)
    bind_snapshot_file_map: dict[str, str] = field(default_factory=_load_bind_snapshot_file_map)
    oidc_bootstrap_name: str = field(
        default_factory=lambda: getenv("ZONIX_OIDC_BOOTSTRAP_NAME", "")
    )
    oidc_bootstrap_issuer: str = field(
        default_factory=lambda: getenv("ZONIX_OIDC_BOOTSTRAP_ISSUER", "")
    )
    oidc_bootstrap_client_id: str = field(
        default_factory=lambda: getenv("ZONIX_OIDC_BOOTSTRAP_CLIENT_ID", "")
    )
    oidc_bootstrap_client_secret: str = field(
        default_factory=lambda: getenv("ZONIX_OIDC_BOOTSTRAP_CLIENT_SECRET", "")
    )
    oidc_bootstrap_scopes: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            scope.strip()
            for scope in getenv("ZONIX_OIDC_BOOTSTRAP_SCOPES", "openid,profile,email").split(",")
            if scope.strip()
        )
    )
    oidc_bootstrap_claims_mapping_rules: dict[str, object] = field(
        default_factory=lambda: loads(getenv("ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES", "{}"))
    )
    bootstrap_users: tuple[dict[str, object], ...] = field(
        default_factory=lambda: tuple(_load_bootstrap_users())
    )
    bootstrap_zone_grants: tuple[dict[str, object], ...] = field(
        default_factory=lambda: tuple(_load_bootstrap_zone_grants())
    )

    def __post_init__(self) -> None:
        if not self.session_cookie_name:
            raise ValueError("ZONIX_SESSION_COOKIE_NAME must not be empty")
        if self.session_cookie_samesite not in {"lax", "strict", "none"}:
            raise ValueError("ZONIX_SESSION_COOKIE_SAMESITE must be one of lax, strict, none")
        if self.session_cookie_samesite == "none" and not self.session_cookie_secure:
            raise ValueError("ZONIX_SESSION_COOKIE_SECURE must be true when SameSite=None")
        if not self.session_cookie_path.startswith("/"):
            raise ValueError("ZONIX_SESSION_COOKIE_PATH must start with /")
        if self.session_ttl_seconds <= 0:
            raise ValueError("ZONIX_SESSION_TTL_SECONDS must be positive")
        if not self.powerdns_backend_name:
            raise ValueError("ZONIX_POWERDNS_BACKEND_NAME must not be empty")
        if not self.powerdns_api_url:
            raise ValueError("ZONIX_POWERDNS_API_URL must not be empty")
        if not self.powerdns_api_key:
            raise ValueError("ZONIX_POWERDNS_API_KEY must not be empty")
        if not self.powerdns_server_id:
            raise ValueError("ZONIX_POWERDNS_SERVER_ID must not be empty")
        if self.powerdns_timeout_seconds <= 0:
            raise ValueError("ZONIX_POWERDNS_TIMEOUT_SECONDS must be positive")
        if not self.bind_backend_name:
            raise ValueError("ZONIX_BIND_BACKEND_NAME must not be empty")
        if self.bind_backend_enabled:
            if not self.bind_server_host:
                raise ValueError("ZONIX_BIND_SERVER_HOST must not be empty")
            if self.bind_server_port <= 0 or self.bind_server_port > 65535:
                raise ValueError("ZONIX_BIND_SERVER_PORT must be between 1 and 65535")
            if self.bind_timeout_seconds <= 0:
                raise ValueError("ZONIX_BIND_TIMEOUT_SECONDS must be positive")
            if not self.bind_zone_names:
                raise ValueError(
                    "ZONIX_BIND_ZONE_NAMES must define at least one zone "
                    "when BIND backend is enabled"
                )
            if bool(self.bind_tsig_key_name) != bool(self.bind_tsig_secret):
                raise ValueError(
                    "ZONIX_BIND_TSIG_KEY_NAME and ZONIX_BIND_TSIG_SECRET must be provided together"
                )
        if not isinstance(self.oidc_bootstrap_claims_mapping_rules, dict):
            raise ValueError("ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES must decode to an object")
        for user in self.bootstrap_users:
            username = user.get("username")
            role = user.get("role")
            auth_source = user.get("authSource", "local")
            password = user.get("password", "")
            is_active = user.get("isActive", True)
            if not isinstance(username, str) or not username.strip():
                raise ValueError("ZONIX_BOOTSTRAP_USERS_JSON entries must define username")
            if role not in {"admin", "editor", "viewer"}:
                raise ValueError("ZONIX_BOOTSTRAP_USERS_JSON entries must define a valid role")
            if not isinstance(auth_source, str) or not auth_source.strip():
                raise ValueError(
                    "ZONIX_BOOTSTRAP_USERS_JSON entries must define authSource"
                )
            if auth_source == "local" and (not isinstance(password, str) or not password):
                raise ValueError(
                    "ZONIX_BOOTSTRAP_USERS_JSON local entries must define password"
                )
            if not isinstance(is_active, bool):
                raise ValueError(
                    "ZONIX_BOOTSTRAP_USERS_JSON entries must define boolean isActive"
                )
        for grant in self.bootstrap_zone_grants:
            username = grant.get("username")
            zone_name = grant.get("zoneName")
            actions = grant.get("actions")
            if not isinstance(username, str) or not username.strip():
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON entries must define username"
                )
            if not isinstance(zone_name, str) or not zone_name.strip():
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON entries must define zoneName"
                )
            if not isinstance(actions, list) or not actions:
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON entries must define actions"
                )
            invalid_actions = [
                action
                for action in actions
                if action not in {"read", "write", "grant"}
            ]
            if invalid_actions:
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON entries contain invalid actions"
                )
        if self.bootstrap_admin_enabled and not self.bootstrap_admin_password:
            raise ValueError(
                "ZONIX_BOOTSTRAP_ADMIN_PASSWORD must not be empty when bootstrap is enabled"
            )

        if self.environment != "development":
            if self.session_secret_key == "local-dev-session-secret-change-me-32-bytes":
                raise ValueError("ZONIX_SESSION_SECRET_KEY must be overridden outside development")
            if (
                self.bootstrap_admin_enabled
                and self.bootstrap_admin_password == "local-dev-admin-change-me"
            ):
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ADMIN_PASSWORD must be overridden outside development"
                )
            if not self.session_cookie_secure:
                raise ValueError("ZONIX_SESSION_COOKIE_SECURE must be true outside development")


settings = Settings()
