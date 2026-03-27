import os
import unittest
from unittest.mock import patch


class SettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base_env = {
            "ZONIX_APP_NAME": "Zonix API",
            "ZONIX_APP_VERSION": "0.1.0",
            "ZONIX_ENV": "development",
            "ZONIX_DATABASE_URL": "postgresql://zonix:zonix@127.0.0.1:55432/zonix",
            "ZONIX_BOOTSTRAP_ADMIN_USERNAME": "admin",
            "ZONIX_BOOTSTRAP_ADMIN_PASSWORD": "admin",
            "ZONIX_SESSION_COOKIE_NAME": "zonix_session",
            "ZONIX_SESSION_SECRET_KEY": "zonix-dev-session-secret",
            "ZONIX_SESSION_TTL_SECONDS": "43200",
        }

    def test_production_requires_non_default_session_secret(self) -> None:
        env = self.base_env | {"ZONIX_ENV": "production"}

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            with self.assertRaisesRegex(
                ValueError,
                "ZONIX_SESSION_SECRET_KEY must be overridden outside development",
            ):
                Settings()

    def test_production_requires_non_default_bootstrap_password(self) -> None:
        env = self.base_env | {
            "ZONIX_ENV": "production",
            "ZONIX_SESSION_SECRET_KEY": "real-secret",
        }

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            with self.assertRaisesRegex(
                ValueError,
                "ZONIX_BOOTSTRAP_ADMIN_PASSWORD must be overridden outside development",
            ):
                Settings()

    def test_development_defaults_remain_allowed(self) -> None:
        with patch.dict(os.environ, self.base_env, clear=True):
            from app.config import Settings

            settings = Settings()

        self.assertEqual(settings.environment, "development")
        self.assertEqual(settings.session_ttl_seconds, 43200)
        self.assertEqual(
            settings.database_url,
            "postgresql://zonix:zonix@127.0.0.1:55432/zonix",
        )


if __name__ == "__main__":
    unittest.main()
