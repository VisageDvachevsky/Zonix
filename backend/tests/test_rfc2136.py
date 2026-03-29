import unittest

from app.domain.models import RecordSet
from app.rfc2136 import (
    RFC2136Adapter,
    RFC2136Client,
    RFC2136ConnectionError,
    RFC2136ResponseError,
)
from app.zone_reads import UpstreamReadError


class FakeName:
    def __init__(self, text: str) -> None:
        self.text = text

    def derelativize(self, origin: FakeName) -> FakeName:
        normalized_text = self.text[:-1] if self.text.endswith(".") else self.text
        normalized_origin = origin.text[:-1] if origin.text.endswith(".") else origin.text
        if normalized_text in {"@", normalized_origin}:
            return FakeName(f"{normalized_origin}.")
        if self.text.endswith("."):
            return self
        return FakeName(f"{normalized_text}.{normalized_origin}.")

    def to_text(self, omit_final_dot: bool = False) -> str:
        normalized = self.text if self.text.endswith(".") else f"{self.text}."
        return normalized[:-1] if omit_final_dot else normalized


class FakeRdata:
    def __init__(self, text: str) -> None:
        self.text = text

    def to_text(self, origin: FakeName | None = None, relativize: bool = False) -> str:
        del origin, relativize
        return self.text


class FakeRdataset:
    def __init__(self, rdtype: str, ttl: int, values: tuple[str, ...]) -> None:
        self.rdtype = rdtype
        self.ttl = ttl
        self._values = tuple(FakeRdata(value) for value in values)

    def __iter__(self):
        return iter(self._values)


class FakeNode:
    def __init__(self, rdatasets: tuple[FakeRdataset, ...]) -> None:
        self.rdatasets = rdatasets


class FakeZone:
    def __init__(self, origin: FakeName, nodes: dict[FakeName, FakeNode]) -> None:
        self.origin = origin
        self.nodes = nodes


class RFC2136ClientTests(unittest.TestCase):
    def test_client_maps_zone_transfer_payload_into_core_models(self) -> None:
        client = RFC2136Client(
            server_host="bind",
            axfr_fetcher=lambda _zone_name: FakeZone(
                origin=FakeName("example.com."),
                nodes={
                    FakeName("@"): FakeNode(
                        (
                            FakeRdataset(
                                "SOA",
                                3600,
                                (
                                    "ns1.example.com. hostmaster.example.com. "
                                    "1 3600 600 1209600 3600",
                                ),
                            ),
                        )
                    ),
                    FakeName("www"): FakeNode((FakeRdataset("A", 300, ("192.0.2.10",)),)),
                },
            ),
        )

        records = client.transfer_zone("example.com")

        self.assertEqual(
            [(record.name, record.record_type, record.ttl, record.values) for record in records],
            [
                (
                    "@",
                    "SOA",
                    3600,
                    ("ns1.example.com. hostmaster.example.com. 1 3600 600 1209600 3600",),
                ),
                ("www", "A", 300, ("192.0.2.10",)),
            ],
        )

    def test_client_emits_update_specs_for_replace_and_delete(self) -> None:
        sent_updates: list[dict[str, object]] = []

        client = RFC2136Client(
            server_host="bind",
            tsig_key_name="zonix-key.",
            tsig_secret="super-secret",
            update_sender=lambda operation: sent_updates.append(dict(operation)),
        )

        client.replace_record_set(
            RecordSet(
                zone_name="example.com",
                name="www",
                record_type="A",
                ttl=300,
                values=("192.0.2.10",),
            )
        )
        client.delete_record_set("example.com", "www", "A")

        self.assertEqual(len(sent_updates), 2)
        self.assertEqual(sent_updates[0]["operation"], "replace")
        self.assertEqual(sent_updates[0]["zone_name"], "example.com")
        self.assertEqual(sent_updates[0]["name"], "www")
        self.assertEqual(sent_updates[0]["record_type"], "A")
        self.assertEqual(sent_updates[0]["ttl"], 300)
        self.assertEqual(sent_updates[1]["operation"], "delete")
        self.assertEqual(sent_updates[1]["name"], "www")


class RFC2136AdapterTests(unittest.TestCase):
    def test_adapter_exposes_manual_zone_inventory(self) -> None:
        adapter = RFC2136Adapter(
            backend_name="bind-lab",
            zone_names=("lab.example", "example.com"),
            client=RFC2136Client(
                server_host="bind",
                axfr_fetcher=lambda _zone_name: (),
            ),
        )

        zones = adapter.list_zones()

        self.assertEqual([zone.name for zone in zones], ["example.com", "lab.example"])
        self.assertEqual(adapter.get_zone("lab.example"), zones[1])
        self.assertIsNone(adapter.get_zone("ghost.example"))

    def test_adapter_falls_back_to_snapshot_when_axfr_fails(self) -> None:
        adapter = RFC2136Adapter(
            backend_name="bind-lab",
            zone_names=("lab.example",),
            client=RFC2136Client(
                server_host="bind",
                axfr_fetcher=lambda _zone_name: (_ for _ in ()).throw(
                    RFC2136ResponseError("AXFR refused")
                ),
            ),
            snapshot_readers={
                "lab.example": lambda: (
                    RecordSet(
                        zone_name="lab.example",
                        name="@",
                        record_type="TXT",
                        ttl=300,
                        values=('"snapshot"',),
                    ),
                )
            },
        )

        records = adapter.list_records("lab.example")

        self.assertEqual(
            [(record.name, record.record_type, record.values) for record in records],
            [("@", "TXT", ('"snapshot"',))],
        )

    def test_adapter_converts_write_failures_into_upstream_errors(self) -> None:
        adapter = RFC2136Adapter(
            backend_name="bind-lab",
            zone_names=("lab.example",),
            client=RFC2136Client(
                server_host="bind",
                tsig_key_name="zonix-key.",
                tsig_secret="super-secret",
                update_sender=lambda _operation: (_ for _ in ()).throw(
                    RFC2136ConnectionError("write failed")
                ),
            ),
        )

        with self.assertRaisesRegex(UpstreamReadError, "write failed"):
            adapter.create_record_set(
                RecordSet(
                    zone_name="lab.example",
                    name="api",
                    record_type="TXT",
                    ttl=300,
                    values=('"bind"',),
                )
            )


if __name__ == "__main__":
    unittest.main()
