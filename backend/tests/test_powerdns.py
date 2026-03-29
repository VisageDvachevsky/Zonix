import unittest
from json import loads

from app.domain.models import RecordSet
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
                                    "ns1.example.com hostmaster.example.com 1 3600 600 1209600 3600"
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

    def test_adapter_writes_patch_payload_for_replace_and_delete(self) -> None:
        write_calls: list[tuple[str, dict[str, str], float, bytes]] = []

        def write_fetcher(
            url: str,
            headers: dict[str, str],
            timeout: float,
            body: bytes,
        ) -> None:
            write_calls.append((url, headers, timeout, body))

        adapter = PowerDNSReadAdapter(
            backend_name="powerdns-local",
            client=PowerDNSClient(
                api_url="http://powerdns:8081",
                api_key="test-key",
                server_id="localhost",
                fetcher=lambda *_args: [],
                write_fetcher=write_fetcher,
            ),
        )

        created_a = adapter.create_record_set(
            RecordSet(
                zone_name="example.com",
                name="www",
                record_type="A",
                ttl=300,
                values=("192.0.2.10",),
            )
        )
        created_txt = adapter.create_record_set(
            RecordSet(
                zone_name="example.com",
                name="txt",
                record_type="TXT",
                ttl=300,
                values=("hello world", 'say "hi"'),
            )
        )
        adapter.delete_record_set("example.com", "www", "A")

        self.assertEqual(len(write_calls), 3)
        self.assertEqual(created_a.values, ("192.0.2.10",))
        self.assertEqual(created_txt.values, ('"hello world"', r'"say \"hi\""'))
        replace_payload = loads(write_calls[0][3].decode("utf-8"))
        txt_payload = loads(write_calls[1][3].decode("utf-8"))
        delete_payload = loads(write_calls[2][3].decode("utf-8"))
        self.assertEqual(replace_payload["rrsets"][0]["changetype"], "REPLACE")
        self.assertEqual(replace_payload["rrsets"][0]["name"], "www.example.com.")
        self.assertEqual(replace_payload["rrsets"][0]["records"][0]["content"], "192.0.2.10")
        self.assertEqual(txt_payload["rrsets"][0]["name"], "txt.example.com.")
        self.assertEqual(
            txt_payload["rrsets"][0]["records"],
            [
                {"content": '"hello world"', "disabled": False},
                {"content": r'"say \"hi\""', "disabled": False},
            ],
        )
        self.assertEqual(delete_payload["rrsets"][0]["changetype"], "DELETE")
        self.assertEqual(delete_payload["rrsets"][0]["type"], "A")

    def test_adapter_converts_write_failures_into_upstream_errors(self) -> None:
        def write_fetcher(
            _url: str,
            _headers: dict[str, str],
            _timeout: float,
            _body: bytes,
        ) -> None:
            raise PowerDNSConnectionError("write failed")

        adapter = PowerDNSReadAdapter(
            backend_name="powerdns-local",
            client=PowerDNSClient(
                api_url="http://powerdns:8081",
                api_key="test-key",
                server_id="localhost",
                fetcher=lambda *_args: [],
                write_fetcher=write_fetcher,
            ),
        )

        with self.assertRaisesRegex(UpstreamReadError, "write failed"):
            adapter.create_record_set(
                RecordSet(
                    zone_name="example.com",
                    name="api",
                    record_type="TXT",
                    ttl=300,
                    values=('"test"',),
                )
            )


if __name__ == "__main__":
    unittest.main()
