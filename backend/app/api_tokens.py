from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe
from typing import Protocol

from app.auth import InMemoryUserRepository, UserRecord, UserRepository
from app.config import settings
from app.database import connect
from app.domain.models import Role, User

SERVICE_ACCOUNT_AUTH_SOURCE = "service-account"
TOKEN_PREFIX = "zonix_tok"


@dataclass(frozen=True)
class ApiTokenRecord:
    token_id: str
    username: str
    token_name: str
    token_hash: str
    is_active: bool
    created_at: datetime
    last_used_at: datetime | None = None


@dataclass(frozen=True)
class IssuedApiToken:
    token: str
    record: ApiTokenRecord


class ApiTokenRepository(Protocol):
    def add(self, record: ApiTokenRecord) -> ApiTokenRecord: ...

    def get_by_id(self, token_id: str) -> ApiTokenRecord | None: ...

    def touch_last_used(self, token_id: str) -> None: ...


class InMemoryApiTokenRepository:
    def __init__(self) -> None:
        self.tokens: dict[str, ApiTokenRecord] = {}

    def add(self, record: ApiTokenRecord) -> ApiTokenRecord:
        self.tokens[record.token_id] = record
        return record

    def get_by_id(self, token_id: str) -> ApiTokenRecord | None:
        return self.tokens.get(token_id)

    def touch_last_used(self, token_id: str) -> None:
        record = self.tokens.get(token_id)
        if record is None:
            return
        self.tokens[token_id] = ApiTokenRecord(
            token_id=record.token_id,
            username=record.username,
            token_name=record.token_name,
            token_hash=record.token_hash,
            is_active=record.is_active,
            created_at=record.created_at,
            last_used_at=datetime.now(UTC),
        )


class DatabaseApiTokenRepository:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or settings.database_url

    def add(self, record: ApiTokenRecord) -> ApiTokenRecord:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO api_tokens (
                        token_id,
                        username,
                        token_name,
                        token_hash,
                        is_active,
                        created_at,
                        last_used_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        record.token_id,
                        record.username,
                        record.token_name,
                        record.token_hash,
                        record.is_active,
                        record.created_at,
                        record.last_used_at,
                    ),
                )
            connection.commit()
        return record

    def get_by_id(self, token_id: str) -> ApiTokenRecord | None:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT token_id, username, token_name, token_hash, is_active, created_at, last_used_at
                    FROM api_tokens
                    WHERE token_id = %s
                    """,
                    (token_id,),
                )
                row = cursor.fetchone()

        if row is None:
            return None
        created_at = row[5].astimezone(UTC) if hasattr(row[5], "astimezone") else row[5]
        last_used_at = (
            row[6].astimezone(UTC) if row[6] is not None and hasattr(row[6], "astimezone") else row[6]
        )
        return ApiTokenRecord(
            token_id=str(row[0]),
            username=str(row[1]),
            token_name=str(row[2]),
            token_hash=str(row[3]),
            is_active=bool(row[4]),
            created_at=created_at,
            last_used_at=last_used_at,
        )

    def touch_last_used(self, token_id: str) -> None:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE api_tokens
                    SET last_used_at = NOW()
                    WHERE token_id = %s
                    """,
                    (token_id,),
                )
            connection.commit()


class ApiTokenService:
    def __init__(
        self,
        user_repository: UserRepository,
        repository: ApiTokenRepository,
    ) -> None:
        self.user_repository = user_repository
        self.repository = repository

    def list_service_accounts(self) -> tuple[UserRecord, ...]:
        return tuple(
            user
            for user in self.user_repository.list_all()
            if user.auth_source == SERVICE_ACCOUNT_AUTH_SOURCE
        )

    def create_service_account(self, *, username: str, role: Role) -> UserRecord:
        existing = self.user_repository.get_by_username(username)
        if existing is not None and existing.auth_source != SERVICE_ACCOUNT_AUTH_SOURCE:
            raise ValueError(
                f"user '{username}' already exists with auth source '{existing.auth_source}'"
            )
        return self.user_repository.upsert_external_user(
            username=username,
            role=role,
            auth_source=SERVICE_ACCOUNT_AUTH_SOURCE,
        )

    def issue_token(self, *, username: str, token_name: str) -> IssuedApiToken:
        user = self.user_repository.get_by_username(username)
        if user is None:
            raise ValueError(f"user '{username}' does not exist")
        if user.auth_source != SERVICE_ACCOUNT_AUTH_SOURCE:
            raise ValueError(f"user '{username}' is not a service account")
        if not token_name.strip():
            raise ValueError("token name must not be empty")

        token_id = token_urlsafe(9)
        secret = token_urlsafe(32)
        record = self.repository.add(
            ApiTokenRecord(
                token_id=token_id,
                username=username,
                token_name=token_name.strip(),
                token_hash=self._token_hash(token_id, secret),
                is_active=True,
                created_at=datetime.now(UTC),
            )
        )
        return IssuedApiToken(
            token=f"{TOKEN_PREFIX}_{token_id}.{secret}",
            record=record,
        )

    def authenticate(self, bearer_token: str | None) -> User | None:
        parsed = self._parse_token(bearer_token)
        if parsed is None:
            return None
        token_id, secret = parsed
        record = self.repository.get_by_id(token_id)
        if record is None or not record.is_active:
            return None
        if not compare_digest(record.token_hash, self._token_hash(token_id, secret)):
            return None

        user = self.user_repository.get_by_username(record.username)
        if user is None or not user.is_active:
            return None

        self.repository.touch_last_used(token_id)
        return user.to_user()

    @staticmethod
    def _parse_token(token: str | None) -> tuple[str, str] | None:
        if token is None or not token.startswith(f"{TOKEN_PREFIX}_"):
            return None
        remainder = token[len(TOKEN_PREFIX) + 1 :]
        if "." not in remainder:
            return None
        token_id, secret = remainder.split(".", maxsplit=1)
        if not token_id or not secret:
            return None
        return token_id, secret

    @staticmethod
    def _token_hash(token_id: str, secret: str) -> str:
        return sha256(f"{token_id}:{secret}".encode("utf-8")).hexdigest()


def build_api_token_service_for_user_repository(user_repository: UserRepository) -> ApiTokenService:
    repository: ApiTokenRepository
    if isinstance(user_repository, InMemoryUserRepository):
        repository = InMemoryApiTokenRepository()
    else:
        repository = DatabaseApiTokenRepository()
    return ApiTokenService(user_repository=user_repository, repository=repository)
