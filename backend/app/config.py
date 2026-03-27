from dataclasses import dataclass
from os import getenv


@dataclass(frozen=True)
class Settings:
    app_name: str = getenv("ZONIX_APP_NAME", "Zonix API")
    app_version: str = getenv("ZONIX_APP_VERSION", "0.1.0")
    environment: str = getenv("ZONIX_ENV", "development")
    database_url: str = getenv(
        "ZONIX_DATABASE_URL",
        "postgresql://zonix:zonix@localhost:5432/zonix",
    )
    bootstrap_admin_username: str = getenv("ZONIX_BOOTSTRAP_ADMIN_USERNAME", "admin")
    bootstrap_admin_password: str = getenv("ZONIX_BOOTSTRAP_ADMIN_PASSWORD", "admin")


settings = Settings()
