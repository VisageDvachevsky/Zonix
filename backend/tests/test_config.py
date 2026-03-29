import os
import unittest
from importlib import import_module
from unittest.mock import patch


class SettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base_env = {
            "ZONIX_APP_NAME": "Zonix API",
            "ZONIX_APP_VERSION": "0.1.0",
            "ZONIX_ENV": "development",
            "ZONIX_DATABASE_URL": "postgresql://zonix:zonix@127.0.0.1:55432/zonix",
            "ZONIX_BOOTSTRAP_ADMIN_USERNAME": "admin",
            "ZONIX_BOOTSTRAP_ADMIN_PASSWORD": "local-dev-admin-change-me",
            "ZONIX_SESSION_COOKIE_NAME": "zonix_session",
            "ZONIX_SESSION_COOKIE_SAMESITE": "lax",
            "ZONIX_SESSION_COOKIE_SECURE": "false",
            "ZONIX_SESSION_SECRET_KEY": "local-dev-session-secret-change-me-32-bytes",
            "ZONIX_SESSION_TTL_SECONDS": "43200",
        }
        with patch.dict(os.environ, self.base_env, clear=True):
            import_module("app.config")

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
        self.assertEqual(settings.session_cookie_samesite, "lax")
        self.assertFalse(settings.session_cookie_secure)
        self.assertEqual(
            settings.database_url,
            "postgresql://zonix:zonix@127.0.0.1:55432/zonix",
        )

    def test_same_site_none_requires_secure_cookie(self) -> None:
        env = self.base_env | {
            "ZONIX_SESSION_COOKIE_SAMESITE": "none",
            "ZONIX_SESSION_COOKIE_SECURE": "false",
        }

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            with self.assertRaisesRegex(
                ValueError,
                "ZONIX_SESSION_COOKIE_SECURE must be true when SameSite=None",
            ):
                Settings()

    def test_bind_backend_requires_manual_zone_inventory_when_enabled(self) -> None:
        env = self.base_env | {
            "ZONIX_POWERDNS_BACKEND_ENABLED": "false",
            "ZONIX_BIND_BACKEND_ENABLED": "true",
            "ZONIX_BIND_ZONE_NAMES": "",
        }

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            with self.assertRaisesRegex(
                ValueError,
                "ZONIX_BIND_ZONE_NAMES must define at least one zone",
            ):
                Settings()

    def test_bind_backend_requires_complete_tsig_pair(self) -> None:
        env = self.base_env | {
            "ZONIX_POWERDNS_BACKEND_ENABLED": "false",
            "ZONIX_BIND_BACKEND_ENABLED": "true",
            "ZONIX_BIND_ZONE_NAMES": "lab.example",
            "ZONIX_BIND_TSIG_KEY_NAME": "zonix-key.",
            "ZONIX_BIND_TSIG_SECRET": "",
        }

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            with self.assertRaisesRegex(
                ValueError,
                "ZONIX_BIND_TSIG_KEY_NAME and ZONIX_BIND_TSIG_SECRET must be provided together",
            ):
                Settings()

    def test_powerdns_requirements_can_be_disabled_for_bind_only_runtime(self) -> None:
        env = self.base_env | {
            "ZONIX_POWERDNS_BACKEND_ENABLED": "false",
            "ZONIX_POWERDNS_API_URL": "",
            "ZONIX_POWERDNS_API_KEY": "",
            "ZONIX_POWERDNS_SERVER_ID": "",
            "ZONIX_BIND_BACKEND_ENABLED": "true",
            "ZONIX_BIND_ZONE_NAMES": "lab.example",
        }

        with patch.dict(os.environ, env, clear=True):
            from app.config import Settings

            settings = Settings()

        self.assertFalse(settings.powerdns_backend_enabled)
        self.assertTrue(settings.bind_backend_enabled)


if __name__ == "__main__":
    unittest.main()
