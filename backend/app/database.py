from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.config import settings


def _import_psycopg() -> Any:
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - only hit in incomplete local envs
        raise RuntimeError(
            "psycopg is required for database access. Install backend dependencies first."
        ) from error

    return psycopg


@contextmanager
def connect(database_url: str | None = None) -> Iterator[Any]:
    psycopg = _import_psycopg()

    with psycopg.connect(
        database_url or settings.database_url,
        connect_timeout=settings.database_connect_timeout_seconds,
    ) as connection:
        yield connection


def ping_database(database_url: str | None = None) -> bool:
    try:
        with connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
    except Exception:
        return False
    return True
