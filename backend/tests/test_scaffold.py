import unittest
from pathlib import Path

from app.security import hash_password, verify_password


class ScaffoldTests(unittest.TestCase):
    def test_password_hash_roundtrip(self) -> None:
        encoded = hash_password("admin")
        self.assertTrue(verify_password("admin", encoded))
        self.assertFalse(verify_password("wrong", encoded))

    def test_initial_sql_migration_exists(self) -> None:
        migration_path = Path(__file__).resolve().parent.parent / "migrations" / "0001_initial.sql"
        self.assertTrue(migration_path.exists())
        contents = migration_path.read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS users", contents)
        self.assertIn("CREATE TABLE IF NOT EXISTS backends", contents)


if __name__ == "__main__":
    unittest.main()
