from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from json import dumps
from typing import Protocol

from app.database import connect
from app.domain.models import IdentityProvider, IdentityProviderKind


class IdentityProviderRepository(Protocol):
    def add(self, provider: IdentityProvider) -> IdentityProvider: ...

    def list_all(self) -> tuple[IdentityProvider, ...]: ...

    def get_by_name(self, name: str) -> IdentityProvider | None: ...

    def delete(self, name: str) -> bool: ...


@dataclass
class InMemoryIdentityProviderRepository:
    providers: dict[str, IdentityProvider] | None = None

    def __post_init__(self) -> None:
        self.providers = {} if self.providers is None else dict(self.providers)

    def add(self, provider: IdentityProvider) -> IdentityProvider:
        self.providers[provider.name] = provider
        return provider

    def list_all(self) -> tuple[IdentityProvider, ...]:
        return tuple(sorted(self.providers.values(), key=lambda provider: provider.name))

    def get_by_name(self, name: str) -> IdentityProvider | None:
        return self.providers.get(name)

    def delete(self, name: str) -> bool:
        return self.providers.pop(name, None) is not None


class DatabaseIdentityProviderRepository:
    def __init__(
        self,
        database_url: str,
        connect_fn: Callable[[str | None], object] = connect,
    ) -> None:
        self.database_url = database_url
        self.connect_fn = connect_fn

    def add(self, provider: IdentityProvider) -> IdentityProvider:
        with self.connect_fn(self.database_url) as connection:
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
                        provider.name,
                        provider.kind.value,
                        provider.issuer,
                        provider.client_id,
                        provider.client_secret,
                        list(provider.scopes),
                        dumps(provider.claims_mapping_rules),
                    ),
                )
            connection.commit()
        return provider

    def list_all(self) -> tuple[IdentityProvider, ...]:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        name,
                        kind,
                        issuer,
                        client_id,
                        client_secret,
                        scopes,
                        claims_mapping_rules
                    FROM identity_providers
                    ORDER BY name
                    """
                )
                rows = cursor.fetchall()

        return tuple(self._map_provider(row) for row in rows)

    def get_by_name(self, name: str) -> IdentityProvider | None:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        name,
                        kind,
                        issuer,
                        client_id,
                        client_secret,
                        scopes,
                        claims_mapping_rules
                    FROM identity_providers
                    WHERE name = %s
                    """,
                    (name,),
                )
                row = cursor.fetchone()

        return None if row is None else self._map_provider(row)

    def delete(self, name: str) -> bool:
        with self.connect_fn(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    DELETE FROM identity_providers
                    WHERE name = %s
                    RETURNING name
                    """,
                    (name,),
                )
                row = cursor.fetchone()
            connection.commit()

        return row is not None

    @staticmethod
    def _map_provider(row: tuple[object, ...]) -> IdentityProvider:
        return IdentityProvider(
            name=str(row[0]),
            kind=IdentityProviderKind(str(row[1])),
            issuer=str(row[2]),
            clientId=str(row[3]),
            clientSecret=str(row[4]),
            scopes=tuple(str(value) for value in (row[5] or [])),
            claimsMappingRules={} if row[6] is None else dict(row[6]),
        )


class IdentityProviderService:
    def __init__(self, repository: IdentityProviderRepository) -> None:
        self.repository = repository

    def register_provider(self, provider: IdentityProvider) -> IdentityProvider:
        return self.repository.add(provider)

    def list_providers(self) -> tuple[IdentityProvider, ...]:
        return self.repository.list_all()

    def get_provider(self, name: str) -> IdentityProvider | None:
        return self.repository.get_by_name(name)

    def delete_provider(self, name: str) -> bool:
        return self.repository.delete(name)
