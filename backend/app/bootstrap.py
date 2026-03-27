from collections.abc import Callable
from typing import Any

from app.config import settings
from app.database import connect
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


def main() -> None:
    created = ensure_bootstrap_admin()
    if created:
        print(f"Bootstrap admin '{settings.bootstrap_admin_username}' created")
    else:
        print(f"Bootstrap admin '{settings.bootstrap_admin_username}' already exists")


if __name__ == "__main__":
    main()
