from __future__ import annotations

from base64 import urlsafe_b64decode, urlsafe_b64encode
from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
from hmac import new as hmac_new
from json import dumps, loads
from time import time
from typing import Protocol

from app.config import settings
from app.database import connect
from app.domain.models import Role, User
from app.security import verify_password


class UserRepository(Protocol):
    def get_by_username(self, username: str) -> UserRecord | None: ...

    def list_all(self) -> tuple[UserRecord, ...]: ...

    def update_role(self, *, username: str, role: Role) -> UserRecord | None: ...

    def upsert_external_user(
        self,
        *,
        username: str,
        role: Role,
        auth_source: str,
    ) -> UserRecord: ...


@dataclass(frozen=True)
class UserRecord:
    username: str
    password_hash: str
    role: Role
    auth_source: str
    is_active: bool

    def to_user(self) -> User:
        return User(username=self.username, role=self.role)


class DatabaseUserRepository:
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or settings.database_url

    def get_by_username(self, username: str) -> UserRecord | None:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT username, password_hash, role, auth_source, is_active
                    FROM users
                    WHERE username = %s
                    """,
                    (username,),
                )
                row = cursor.fetchone()

        if row is None:
            return None

        return UserRecord(
            username=row[0],
            password_hash=row[1],
            role=Role(row[2]),
            auth_source=row[3],
            is_active=bool(row[4]),
        )

    def list_all(self) -> tuple[UserRecord, ...]:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT username, password_hash, role, auth_source, is_active
                    FROM users
                    ORDER BY username
                    """
                )
                rows = cursor.fetchall()

        return tuple(
            UserRecord(
                username=row[0],
                password_hash=row[1],
                role=Role(row[2]),
                auth_source=row[3],
                is_active=bool(row[4]),
            )
            for row in rows
        )

    def update_role(self, *, username: str, role: Role) -> UserRecord | None:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE users
                    SET role = %s
                    WHERE username = %s
                    RETURNING username, password_hash, role, auth_source, is_active
                    """,
                    (role.value, username),
                )
                row = cursor.fetchone()
            connection.commit()

        if row is None:
            return None

        return UserRecord(
            username=row[0],
            password_hash=row[1],
            role=Role(row[2]),
            auth_source=row[3],
            is_active=bool(row[4]),
        )

    def upsert_external_user(
        self,
        *,
        username: str,
        role: Role,
        auth_source: str,
    ) -> UserRecord:
        with connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO users (username, password_hash, role, auth_source, is_active)
                    VALUES (%s, %s, %s, %s, TRUE)
                    ON CONFLICT (username) DO UPDATE
                    SET role = EXCLUDED.role,
                        auth_source = EXCLUDED.auth_source,
                        is_active = TRUE
                    RETURNING username, password_hash, role, auth_source, is_active
                    """,
                    (username, "", role.value, auth_source),
                )
                row = cursor.fetchone()
            connection.commit()

        assert row is not None
        return UserRecord(
            username=row[0],
            password_hash=row[1],
            role=Role(row[2]),
            auth_source=row[3],
            is_active=bool(row[4]),
        )


class InMemoryUserRepository:
    def __init__(self, users: Mapping[str, Mapping[str, object]] | None = None) -> None:
        self._users: dict[str, UserRecord] = {}

        for username, payload in (users or {}).items():
            self._users[username] = UserRecord(
                username=str(payload["username"]),
                password_hash=str(payload["password_hash"]),
                role=Role(str(payload["role"])),
                auth_source=str(payload["auth_source"]),
                is_active=bool(payload["is_active"]),
            )

    def get_by_username(self, username: str) -> UserRecord | None:
        return self._users.get(username)

    def list_all(self) -> tuple[UserRecord, ...]:
        return tuple(sorted(self._users.values(), key=lambda user: user.username))

    def update_role(self, *, username: str, role: Role) -> UserRecord | None:
        existing = self._users.get(username)
        if existing is None:
            return None
        updated = UserRecord(
            username=existing.username,
            password_hash=existing.password_hash,
            role=role,
            auth_source=existing.auth_source,
            is_active=existing.is_active,
        )
        self._users[username] = updated
        return updated

    def upsert_external_user(
        self,
        *,
        username: str,
        role: Role,
        auth_source: str,
    ) -> UserRecord:
        record = UserRecord(
            username=username,
            password_hash="",
            role=role,
            auth_source=auth_source,
            is_active=True,
        )
        self._users[username] = record
        return record


class AuthIdentityConflictError(RuntimeError):
    def __init__(self, username: str, auth_source: str) -> None:
        super().__init__(
            "user "
            f"'{username}' already exists with a different auth source "
            f"and cannot sign in via '{auth_source}'"
        )
        self.username = username
        self.auth_source = auth_source


class AuthSelfSignupDisabledError(RuntimeError):
    def __init__(self, username: str, auth_source: str) -> None:
        super().__init__(
            f"user '{username}' is not provisioned for '{auth_source}' and self-signup is disabled"
        )
        self.username = username
        self.auth_source = auth_source


class SessionManager:
    def __init__(
        self,
        secret_key: str,
        session_ttl_seconds: int = 60 * 60 * 12,
    ) -> None:
        if not secret_key:
            raise ValueError("session secret key must not be empty")
        if session_ttl_seconds <= 0:
            raise ValueError("session ttl must be positive")

        self.secret_key = secret_key.encode("utf-8")
        self.session_ttl_seconds = session_ttl_seconds

    def create_session(self, user: User) -> str:
        payload = {
            "sub": user.username,
            "role": user.role.value,
            "exp": int(time()) + self.session_ttl_seconds,
        }
        encoded_payload = self._encode_json(payload)
        signature = self._sign(encoded_payload)
        return f"{encoded_payload}.{signature}"

    def read_session(self, session_token: str | None) -> User | None:
        if not session_token or "." not in session_token:
            return None

        try:
            encoded_payload, signature = session_token.split(".", maxsplit=1)
            expected_signature = self._sign(encoded_payload)
            if not compare_digest(signature, expected_signature):
                return None

            payload = self._decode_json(encoded_payload)
            if int(payload["exp"]) < int(time()):
                return None

            return User(username=str(payload["sub"]), role=Role(str(payload["role"])))
        except KeyError, TypeError, ValueError:
            return None

    def _sign(self, encoded_payload: str) -> str:
        digest = hmac_new(self.secret_key, encoded_payload.encode("ascii"), sha256).digest()
        return urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    @staticmethod
    def _encode_json(payload: dict[str, object]) -> str:
        raw = dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_json(encoded_payload: str) -> dict[str, object]:
        padding = "=" * (-len(encoded_payload) % 4)
        raw = urlsafe_b64decode(f"{encoded_payload}{padding}".encode("ascii"))
        payload = loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("session payload must be an object")
        return payload


class AuthService:
    def __init__(
        self,
        user_repository: UserRepository,
        session_manager: SessionManager,
        *,
        allow_oidc_self_signup: bool = settings.auth_oidc_self_signup_enabled,
    ) -> None:
        self.user_repository = user_repository
        self.session_manager = session_manager
        self.allow_oidc_self_signup = allow_oidc_self_signup

    def authenticate_local_user(self, username: str, password: str) -> User | None:
        user_record = self.user_repository.get_by_username(username)
        if user_record is None or not user_record.is_active:
            return None
        if user_record.auth_source != "local":
            return None
        if not verify_password(password, user_record.password_hash):
            return None
        return user_record.to_user()

    def create_session(self, user: User) -> str:
        return self.session_manager.create_session(user)

    def provision_oidc_user(
        self,
        *,
        username: str,
        role: Role,
        auth_source: str,
    ) -> User:
        existing = self.user_repository.get_by_username(username)
        if existing is not None and existing.auth_source not in {auth_source}:
            raise AuthIdentityConflictError(username, auth_source)
        if existing is None and not self.allow_oidc_self_signup:
            raise AuthSelfSignupDisabledError(username, auth_source)

        user_record = self.user_repository.upsert_external_user(
            username=username,
            role=role,
            auth_source=auth_source,
        )
        return user_record.to_user()

    def get_authenticated_user(self, session_token: str | None) -> User | None:
        session_user = self.session_manager.read_session(session_token)
        if session_user is None:
            return None

        user_record = self.user_repository.get_by_username(session_user.username)
        if user_record is None or not user_record.is_active:
            return None

        return user_record.to_user()

    def list_users(self) -> tuple[UserRecord, ...]:
        return self.user_repository.list_all()

    def update_user_role(self, *, username: str, role: Role) -> User:
        user_record = self.user_repository.update_role(username=username, role=role)
        if user_record is None:
            raise ValueError(f"user '{username}' does not exist")
        return user_record.to_user()
