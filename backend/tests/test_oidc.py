import unittest
from unittest.mock import MagicMock, patch

from app.oidc import OIDCClient


class OIDCClientTests(unittest.TestCase):
    @patch("app.oidc.urlopen")
    @patch("app.oidc.build_opener")
    def test_fetch_json_bypasses_proxy_for_localhost(self, build_opener_mock, urlopen_mock) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"issuer":"http://localhost:5556"}'
        opener = MagicMock()
        opener.open.return_value = response
        build_opener_mock.return_value = opener

        payload = OIDCClient().fetch_json("http://localhost:5556/.well-known/openid-configuration")

        self.assertEqual(payload["issuer"], "http://localhost:5556")
        build_opener_mock.assert_called_once()
        opener.open.assert_called_once()
        urlopen_mock.assert_not_called()

    @patch("app.oidc.urlopen")
    @patch("app.oidc.build_opener")
    def test_fetch_json_bypasses_proxy_for_private_network_hosts(
        self,
        build_opener_mock,
        urlopen_mock,
    ) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = (
            b'{"issuer":"http://192.168.0.105:5556"}'
        )
        opener = MagicMock()
        opener.open.return_value = response
        build_opener_mock.return_value = opener

        payload = OIDCClient().fetch_json(
            "http://192.168.0.105:5556/.well-known/openid-configuration"
        )

        self.assertEqual(payload["issuer"], "http://192.168.0.105:5556")
        build_opener_mock.assert_called_once()
        opener.open.assert_called_once()
        urlopen_mock.assert_not_called()

    @patch("app.oidc.urlopen")
    @patch("app.oidc.build_opener")
    def test_fetch_json_uses_default_transport_for_public_hosts(
        self,
        build_opener_mock,
        urlopen_mock,
    ) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"issuer":"https://issuer.example"}'
        urlopen_mock.return_value = response

        payload = OIDCClient().fetch_json("https://issuer.example/.well-known/openid-configuration")

        self.assertEqual(payload["issuer"], "https://issuer.example")
        urlopen_mock.assert_called_once()
        build_opener_mock.assert_not_called()
