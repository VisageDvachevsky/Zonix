import os
import unittest
from uuid import uuid4

from app.domain.models import RecordSet
from app.powerdns import PowerDNSClient, PowerDNSReadAdapter
from app.zone_reads import UpstreamReadError


class PowerDNSLiveIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        api_url = os.getenv("ZONIX_POWERDNS_API_URL")
        api_key = os.getenv("ZONIX_POWERDNS_API_KEY")
        server_id = os.getenv("ZONIX_POWERDNS_SERVER_ID", "localhost")
        backend_name = os.getenv("ZONIX_POWERDNS_BACKEND_NAME", "powerdns-local")
        zone_name = os.getenv("ZONIX_POWERDNS_TEST_ZONE", "example.com")

        if not api_url or not api_key:
            self.skipTest("live PowerDNS integration test requires PowerDNS env vars")

        self.zone_name = zone_name
        self.adapter = PowerDNSReadAdapter(
            backend_name=backend_name,
            client=PowerDNSClient(
                api_url=api_url,
                api_key=api_key,
                server_id=server_id,
                timeout_seconds=5.0,
            ),
        )
        try:
            self.adapter.list_zones()
        except UpstreamReadError as error:
            self.skipTest(f"live PowerDNS integration test requires healthy upstream: {error}")

    def test_live_powerdns_zone_and_record_reads(self) -> None:
        zones = self.adapter.list_zones()
        zone = self.adapter.get_zone(self.zone_name)
        records = self.adapter.list_records(self.zone_name)

        self.assertIn(self.zone_name, [item.name for item in zones])
        self.assertIsNotNone(zone)
        assert zone is not None
        self.assertEqual(zone.name, self.zone_name)
        self.assertGreater(len(records), 0)
        self.assertTrue(any(record.record_type == "SOA" for record in records))

    def test_live_powerdns_record_write_flow(self) -> None:
        record_name = f"zonix-{uuid4().hex[:8]}"

        try:
            created = self.adapter.create_record_set(
                RecordSet(
                    zone_name=self.zone_name,
                    name=record_name,
                    record_type="TXT",
                    ttl=300,
                    values=("created",),
                )
            )
        except UpstreamReadError as error:
            if "does not support editing records" in str(error):
                self.skipTest(f"live write flow is unsupported by current PowerDNS fixture: {error}")
            raise
        after_create = self.adapter.list_records(self.zone_name)
        self.assertEqual(created.record_type, "TXT")
        self.assertEqual(created.values, ('"created"',))
        self.assertIn(
            (record_name, "TXT", ('"created"',)),
            [(record.name, record.record_type, record.values) for record in after_create],
        )

        updated = self.adapter.update_record_set(
            RecordSet(
                zone_name=self.zone_name,
                name=record_name,
                record_type="TXT",
                ttl=600,
                values=("updated",),
            )
        )
        after_update = self.adapter.list_records(self.zone_name)
        self.assertEqual(updated.ttl, 600)
        self.assertEqual(updated.values, ('"updated"',))
        self.assertIn(
            (record_name, "TXT", ('"updated"',)),
            [(record.name, record.record_type, record.values) for record in after_update],
        )

        self.adapter.delete_record_set(self.zone_name, record_name, "TXT")
        after_delete = self.adapter.list_records(self.zone_name)
        self.assertNotIn(
            (record_name, "TXT"),
            [(record.name, record.record_type) for record in after_delete],
        )


if __name__ == "__main__":
    unittest.main()
