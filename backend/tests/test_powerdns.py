import unittest

from app.powerdns import (
    PowerDNSClient,
    PowerDNSConnectionError,
    PowerDNSReadAdapter,
    PowerDNSResponseError,
)
from app.zone_reads import UpstreamReadError


class PowerDNSReadAdapterTests(unittest.TestCase):
    def test_adapter_maps_zone_detail_and_rrsets_into_core_models(self) -> None:
        def fetcher(url: str, _headers: dict[str, str], _timeout: float) -> object:
            if url.endswith("/zones"):
                return [
                    {"name": "example.com."},
                    {"name": "internal.example."},
                ]

            return {
                "name": "example.com.",
                "rrsets": [
                    {
                        "name": "example.com.",
                        "type": "SOA",
                        "ttl": 3600,
                        "records": [
                            {
                                "content": (
                                    "ns1.example.com hostmaster.example.com "
                                    "1 3600 600 1209600 3600"
                                ),
                                "disabled": False,
                            }
                        ],
                    },
                    {
                        "name": "www.example.com.",
                        "type": "A",
                        "ttl": 300,
                        "records": [
                            {"content": "192.0.2.10", "disabled": False},
                            {"content": "192.0.2.11", "disabled": True},
                        ],
                    },
                ],
            }

        adapter = PowerDNSReadAdapter(
            backend_name="powerdns-local",
            client=PowerDNSClient(
                api_url="http://powerdns:8081",
                api_key="test-key",
                server_id="localhost",
                fetcher=fetcher,
            ),
        )

        zones = adapter.list_zones()
        zone = adapter.get_zone("example.com")
        records = adapter.list_records("example.com")

        self.assertEqual([item.name for item in zones], ["example.com", "internal.example"])
        self.assertIsNotNone(zone)
        assert zone is not None
        self.assertEqual(zone.backend_name, "powerdns-local")
        self.assertEqual(
            [(record.name, record.record_type, record.values) for record in records],
            [
                (
                    "@",
                    "SOA",
                    ("ns1.example.com hostmaster.example.com 1 3600 600 1209600 3600",),
                ),
                ("www", "A", ("192.0.2.10",)),
            ],
        )

    def test_adapter_converts_client_failures_into_upstream_errors(self) -> None:
        def fetcher(_url: str, _headers: dict[str, str], _timeout: float) -> object:
            raise PowerDNSConnectionError("connection refused")

        adapter = PowerDNSReadAdapter(
            backend_name="powerdns-local",
            client=PowerDNSClient(
                api_url="http://powerdns:8081",
                api_key="test-key",
                server_id="localhost",
                fetcher=fetcher,
            ),
        )

        with self.assertRaisesRegex(UpstreamReadError, "connection refused"):
            adapter.list_zones()

    def test_missing_zone_returns_none_from_detail_lookup(self) -> None:
        def fetcher(url: str, _headers: dict[str, str], _timeout: float) -> object:
            if "/zones/example.com." in url:
                raise PowerDNSResponseError(404, "not found")
            return []

        adapter = PowerDNSReadAdapter(
            backend_name="powerdns-local",
            client=PowerDNSClient(
                api_url="http://powerdns:8081",
                api_key="test-key",
                server_id="localhost",
                fetcher=fetcher,
            ),
        )

        self.assertIsNone(adapter.get_zone("example.com"))


if __name__ == "__main__":
    unittest.main()
