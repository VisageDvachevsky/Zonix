from __future__ import annotations

from collections.abc import Callable, Mapping
from json import JSONDecodeError, loads
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.domain.models import RecordSet, Zone
from app.zone_reads import UpstreamReadError


class PowerDNSClientError(RuntimeError):
    """Base PowerDNS client error."""


class PowerDNSResponseError(PowerDNSClientError):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class PowerDNSConnectionError(PowerDNSClientError):
    """PowerDNS could not be reached."""


PowerDNSFetcher = Callable[[str, Mapping[str, str], float], object]


class PowerDNSClient:
    def __init__(
        self,
        api_url: str,
        api_key: str,
        server_id: str,
        timeout_seconds: float = 5.0,
        fetcher: PowerDNSFetcher | None = None,
    ) -> None:
        if not api_url:
            raise ValueError("PowerDNS API URL must not be empty")
        if not api_key:
            raise ValueError("PowerDNS API key must not be empty")
        if not server_id:
            raise ValueError("PowerDNS server id must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("PowerDNS timeout must be positive")

        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.server_id = server_id
        self.timeout_seconds = timeout_seconds
        self.fetcher = fetcher or self._default_fetcher

    def list_zones(self) -> object:
        return self._get(f"/servers/{quote(self.server_id, safe='')}/zones")

    def get_zone(self, zone_name: str) -> object | None:
        zone_id = self._encode_zone_id(zone_name)
        try:
            return self._get(f"/servers/{quote(self.server_id, safe='')}/zones/{zone_id}")
        except PowerDNSResponseError as error:
            if error.status_code == 404:
                return None
            raise

    def _get(self, path: str) -> object:
        return self.fetcher(
            f"{self.api_url}/api/v1{path}",
            {
                "Accept": "application/json",
                "X-API-Key": self.api_key,
            },
            self.timeout_seconds,
        )

    @staticmethod
    def _encode_zone_id(zone_name: str) -> str:
        normalized = zone_name if zone_name.endswith(".") else f"{zone_name}."
        return quote(normalized, safe="")

    @staticmethod
    def _default_fetcher(url: str, headers: Mapping[str, str], timeout_seconds: float) -> object:
        request = Request(url=url, method="GET", headers=dict(headers))

        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                raw_body = response.read().decode("utf-8")
        except HTTPError as error:
            raw_body = error.read().decode("utf-8", errors="ignore")
            raise PowerDNSResponseError(error.code, raw_body or error.reason) from error
        except URLError as error:
            raise PowerDNSConnectionError(str(error.reason)) from error

        try:
            return loads(raw_body)
        except JSONDecodeError as error:
            raise PowerDNSClientError("PowerDNS returned invalid JSON") from error


class PowerDNSReadAdapter:
    def __init__(self, backend_name: str, client: PowerDNSClient) -> None:
        self.backend_name = backend_name
        self.client = client

    def list_zones(self) -> tuple[Zone, ...]:
        payload = self._read_zones_payload()
        try:
            zones = [self._map_zone(item) for item in payload]
        except ValueError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error
        return tuple(sorted(zones, key=lambda zone: zone.name))

    def get_zone(self, zone_name: str) -> Zone | None:
        try:
            payload = self.client.get_zone(zone_name)
        except PowerDNSClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

        if payload is None:
            return None
        if not isinstance(payload, Mapping):
            raise UpstreamReadError(self.backend_name, "PowerDNS zone payload is not an object")
        try:
            return self._map_zone(payload)
        except ValueError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]:
        try:
            payload = self.client.get_zone(zone_name)
        except PowerDNSClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

        if payload is None:
            return ()
        if not isinstance(payload, Mapping):
            raise UpstreamReadError(self.backend_name, "PowerDNS zone payload is not an object")

        normalized_zone_name = self._normalize_dns_name(self._require_str(payload, "name"))
        rrsets = payload.get("rrsets", [])
        if not isinstance(rrsets, list):
            raise UpstreamReadError(self.backend_name, "PowerDNS zone rrsets field is not a list")

        record_sets: list[RecordSet] = []
        try:
            for rrset in rrsets:
                if not isinstance(rrset, Mapping):
                    raise UpstreamReadError(
                        self.backend_name, "PowerDNS rrset entry is not an object"
                    )
                mapped = self._map_rrset(normalized_zone_name, rrset)
                if mapped is not None:
                    record_sets.append(mapped)
        except ValueError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

        return tuple(sorted(record_sets, key=lambda record: (record.name, record.record_type)))

    def _read_zones_payload(self) -> list[Mapping[str, Any]]:
        try:
            payload = self.client.list_zones()
        except PowerDNSClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

        if not isinstance(payload, list):
            raise UpstreamReadError(self.backend_name, "PowerDNS zones payload is not a list")
        if not all(isinstance(item, Mapping) for item in payload):
            raise UpstreamReadError(
                self.backend_name, "PowerDNS zones payload contains invalid items"
            )
        return list(payload)

    def _map_zone(self, payload: Mapping[str, Any]) -> Zone:
        return Zone(
            name=self._normalize_dns_name(self._require_str(payload, "name")),
            backend_name=self.backend_name,
        )

    def _map_rrset(self, zone_name: str, payload: Mapping[str, Any]) -> RecordSet | None:
        records = payload.get("records", [])
        if not isinstance(records, list):
            raise UpstreamReadError(self.backend_name, "PowerDNS rrset records field is not a list")

        values = tuple(
            self._require_str(record, "content")
            for record in records
            if isinstance(record, Mapping) and not bool(record.get("disabled", False))
        )
        if not values:
            return None

        return RecordSet(
            zone_name=zone_name,
            name=self._normalize_record_name(self._require_str(payload, "name"), zone_name),
            record_type=self._require_str(payload, "type").upper(),
            ttl=self._require_int(payload, "ttl"),
            values=values,
        )

    @staticmethod
    def _normalize_dns_name(value: str) -> str:
        return value[:-1] if value.endswith(".") else value

    @classmethod
    def _normalize_record_name(cls, rr_name: str, zone_name: str) -> str:
        normalized = cls._normalize_dns_name(rr_name)
        if normalized == zone_name:
            return "@"

        suffix = f".{zone_name}"
        if normalized.endswith(suffix):
            return normalized[: -len(suffix)]
        return normalized

    @staticmethod
    def _require_str(payload: Mapping[str, Any], key: str) -> str:
        value = payload.get(key)
        if not isinstance(value, str) or not value:
            raise ValueError(f"PowerDNS payload field '{key}' is invalid")
        return value

    @staticmethod
    def _require_int(payload: Mapping[str, Any], key: str) -> int:
        value = payload.get(key)
        if not isinstance(value, int) or value <= 0:
            raise ValueError(f"PowerDNS payload field '{key}' is invalid")
        return value
