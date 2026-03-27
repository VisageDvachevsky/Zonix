from pathlib import Path

from app.config import settings
from app.database import connect

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
SCHEMA_MIGRATIONS_TABLE = "schema_migrations"


def discover_migrations() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def apply_migrations(database_url: str | None = None) -> int:
    migrations = discover_migrations()
    if not migrations:
        return 0

    with connect(database_url or settings.database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cursor.execute(f"SELECT version FROM {SCHEMA_MIGRATIONS_TABLE}")
            applied_versions = {row[0] for row in cursor.fetchall()}

            applied_count = 0
            for migration in migrations:
                if migration.name in applied_versions:
                    continue

                cursor.execute(migration.read_text(encoding="utf-8"))
                cursor.execute(
                    f"INSERT INTO {SCHEMA_MIGRATIONS_TABLE} (version) VALUES (%s)",
                    (migration.name,),
                )
                applied_count += 1

        connection.commit()

    return applied_count


def main() -> None:
    applied_count = apply_migrations()
    print(f"Applied {applied_count} migration(s)")


if __name__ == "__main__":
    main()
