from dataclasses import dataclass, field
from json import loads
from os import getenv
from secrets import token_urlsafe


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
    bootstrap_admin_password: str = field(
        default_factory=lambda: getenv("ZONIX_BOOTSTRAP_ADMIN_PASSWORD") or token_urlsafe(18)
    )
    session_cookie_name: str = field(
        default_factory=lambda: getenv("ZONIX_SESSION_COOKIE_NAME", "zonix_session")
    )
    session_secret_key: str = field(
        default_factory=lambda: getenv("ZONIX_SESSION_SECRET_KEY") or token_urlsafe(32)
    )
    session_ttl_seconds: int = field(
        default_factory=lambda: int(getenv("ZONIX_SESSION_TTL_SECONDS", str(60 * 60 * 12)))
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

    def __post_init__(self) -> None:
        if not self.session_cookie_name:
            raise ValueError("ZONIX_SESSION_COOKIE_NAME must not be empty")
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
        if not isinstance(self.oidc_bootstrap_claims_mapping_rules, dict):
            raise ValueError("ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES must decode to an object")

        if self.environment != "development":
            if self.session_secret_key == "zonix-dev-session-secret":
                raise ValueError("ZONIX_SESSION_SECRET_KEY must be overridden outside development")
            if self.bootstrap_admin_password == "admin":
                raise ValueError(
                    "ZONIX_BOOTSTRAP_ADMIN_PASSWORD must be overridden outside development"
                )


settings = Settings()
