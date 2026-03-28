from collections.abc import Callable
from json import dumps
from typing import Any

from app.config import settings
from app.database import connect
from app.domain.models import IdentityProvider, IdentityProviderKind
from app.security import hash_password


def ensure_bootstrap_admin(
    username: str | None = None,
    password: str | None = None,
    database_url: str | None = None,
    connect_fn: Callable[[str | None], Any] = connect,
) -> bool:
    resolved_username = username or settings.bootstrap_admin_username
    resolved_password = password or settings.bootstrap_admin_password

    if not resolved_username:
        raise ValueError("bootstrap admin username must not be empty")
    if not resolved_password:
        raise ValueError("bootstrap admin password must not be empty")

    password_hash = hash_password(resolved_password)

    with connect_fn(database_url or settings.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT username FROM users WHERE username = %s",
                (resolved_username,),
            )
            existing_user = cursor.fetchone()
            if existing_user:
                return False

            cursor.execute(
                """
                INSERT INTO users (username, password_hash, role, auth_source)
                VALUES (%s, %s, 'admin', 'local')
                """,
                (resolved_username, password_hash),
            )

        connection.commit()

    return True


def ensure_bootstrap_oidc_provider(
    provider: IdentityProvider | None = None,
    database_url: str | None = None,
    connect_fn: Callable[[str | None], Any] = connect,
) -> bool:
    resolved_provider = provider
    if resolved_provider is None:
        if not settings.oidc_bootstrap_name:
            return False
        resolved_provider = IdentityProvider(
            name=settings.oidc_bootstrap_name,
            kind=IdentityProviderKind.OIDC,
            issuer=settings.oidc_bootstrap_issuer,
            clientId=settings.oidc_bootstrap_client_id,
            clientSecret=settings.oidc_bootstrap_client_secret,
            scopes=settings.oidc_bootstrap_scopes,
            claimsMappingRules=settings.oidc_bootstrap_claims_mapping_rules,
        )

    with connect_fn(database_url or settings.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO identity_providers (
                    name,
                    kind,
                    issuer,
                    client_id,
                    client_secret,
                    scopes,
                    claims_mapping_rules
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (name) DO UPDATE
                SET kind = EXCLUDED.kind,
                    issuer = EXCLUDED.issuer,
                    client_id = EXCLUDED.client_id,
                    client_secret = EXCLUDED.client_secret,
                    scopes = EXCLUDED.scopes,
                    claims_mapping_rules = EXCLUDED.claims_mapping_rules
                """,
                (
                    resolved_provider.name,
                    resolved_provider.kind.value,
                    resolved_provider.issuer,
                    resolved_provider.client_id,
                    resolved_provider.client_secret,
                    list(resolved_provider.scopes),
                    dumps(resolved_provider.claims_mapping_rules),
                ),
            )
        connection.commit()

    return True


def main() -> None:
    created = ensure_bootstrap_admin()
    if created:
        print(f"Bootstrap admin '{settings.bootstrap_admin_username}' created")
    else:
        print(f"Bootstrap admin '{settings.bootstrap_admin_username}' already exists")

    oidc_bootstrapped = ensure_bootstrap_oidc_provider()
    if oidc_bootstrapped:
        print(f"OIDC provider '{settings.oidc_bootstrap_name}' bootstrapped")


if __name__ == "__main__":
    main()
