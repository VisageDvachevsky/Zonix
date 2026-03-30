from __future__ import annotations

from collections.abc import Callable, Mapping
from http.client import HTTPConnection, HTTPResponse, HTTPSConnection
from json import JSONDecodeError, dumps, loads
from typing import Any
from urllib.parse import quote
from urllib.parse import urlsplit

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
PowerDNSWriteFetcher = Callable[[str, Mapping[str, str], float, bytes], None]


class PowerDNSClient:
    def __init__(
        self,
        api_url: str,
        api_key: str,
        server_id: str,
        timeout_seconds: float = 5.0,
        fetcher: PowerDNSFetcher | None = None,
        write_fetcher: PowerDNSWriteFetcher | None = None,
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
        self.write_fetcher = write_fetcher or self._default_write_fetcher

    def list_zones(self) -> object:
        return self._get(f"/servers/{quote(self.server_id, safe='')}/zones")

    def get_zone(self, zone_name: str, *, include_rrsets: bool = False) -> object | None:
        zone_id = self._encode_zone_id(zone_name)
        query = "?rrsets=true" if include_rrsets else ""
        try:
            return self._get(f"/servers/{quote(self.server_id, safe='')}/zones/{zone_id}{query}")
        except PowerDNSResponseError as error:
            if error.status_code == 404:
                return None
            raise

    def patch_zone(self, zone_name: str, payload: Mapping[str, Any]) -> None:
        zone_id = self._encode_zone_id(zone_name)
        raw_body = dumps(payload).encode("utf-8")
        try:
            self.write_fetcher(
                f"{self.api_url}/api/v1/servers/{quote(self.server_id, safe='')}/zones/{zone_id}",
                {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-API-Key": self.api_key,
                },
                self.timeout_seconds,
                raw_body,
            )
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
        try:
            raw_body = PowerDNSClient._perform_http_request(
                url=url,
                method="GET",
                headers=headers,
                timeout_seconds=timeout_seconds,
            )
        except OSError as error:
            raise PowerDNSConnectionError(str(error)) from error

        try:
            return loads(raw_body)
        except JSONDecodeError as error:
            raise PowerDNSClientError("PowerDNS returned invalid JSON") from error

    @staticmethod
    def _default_write_fetcher(
        url: str,
        headers: Mapping[str, str],
        timeout_seconds: float,
        body: bytes,
    ) -> None:
        try:
            PowerDNSClient._perform_http_request(
                url=url,
                method="PATCH",
                headers=headers,
                timeout_seconds=timeout_seconds,
                body=body,
            )
        except OSError as error:
            raise PowerDNSConnectionError(str(error)) from error

    @staticmethod
    def _perform_http_request(
        *,
        url: str,
        method: str,
        headers: Mapping[str, str],
        timeout_seconds: float,
        body: bytes | None = None,
    ) -> str:
        parsed = urlsplit(url)
        if not parsed.hostname:
            raise PowerDNSClientError("PowerDNS request URL is missing a hostname")

        connection_class = HTTPSConnection if parsed.scheme == "https" else HTTPConnection
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        connection = connection_class(parsed.hostname, port, timeout=timeout_seconds)
        try:
            connection.request(method, path, body=body, headers=dict(headers))
            response = connection.getresponse()
            raw_body = response.read().decode("utf-8", errors="ignore")
        finally:
            connection.close()

        PowerDNSClient._raise_for_status(response, raw_body)
        return raw_body

    @staticmethod
    def _raise_for_status(response: HTTPResponse, raw_body: str) -> None:
        if 200 <= response.status < 300:
            return
        raise PowerDNSResponseError(response.status, raw_body or response.reason or "HTTP error")


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
            payload = self.client.get_zone(zone_name, include_rrsets=True)
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

    def create_record_set(self, record_set: RecordSet) -> RecordSet:
        self._patch_rrset(record_set, changetype="REPLACE")
        return self._normalize_record_set(record_set)

    def update_record_set(self, record_set: RecordSet) -> RecordSet:
        self._patch_rrset(record_set, changetype="REPLACE")
        return self._normalize_record_set(record_set)

    def delete_record_set(self, zone_name: str, name: str, record_type: str) -> None:
        try:
            self.client.patch_zone(
                zone_name,
                {
                    "rrsets": [
                        {
                            "name": self._to_absolute_record_name(zone_name, name),
                            "type": record_type.upper(),
                            "changetype": "DELETE",
                        }
                    ]
                },
            )
        except PowerDNSClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

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

    @classmethod
    def _to_absolute_record_name(cls, zone_name: str, rr_name: str) -> str:
        normalized_zone_name = cls._normalize_dns_name(zone_name)
        normalized_rr_name = cls._normalize_dns_name(rr_name)
        if normalized_rr_name == "@":
            return f"{normalized_zone_name}."
        if normalized_rr_name.endswith(f".{normalized_zone_name}") or normalized_rr_name == normalized_zone_name:
            return f"{normalized_rr_name}."
        return f"{normalized_rr_name}.{normalized_zone_name}."

    def _patch_rrset(self, record_set: RecordSet, *, changetype: str) -> None:
        try:
            self.client.patch_zone(
                record_set.zone_name,
                {
                    "rrsets": [
                        {
                            "name": self._to_absolute_record_name(record_set.zone_name, record_set.name),
                            "type": record_set.record_type,
                            "ttl": record_set.ttl,
                            "changetype": changetype,
                            "records": [
                                {
                                    "content": self._serialize_record_value(
                                        record_set.record_type,
                                        value,
                                    ),
                                    "disabled": False,
                                }
                                for value in record_set.values
                            ],
                        }
                    ]
                },
            )
        except PowerDNSClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

    @classmethod
    def _normalize_record_set(cls, record_set: RecordSet) -> RecordSet:
        return record_set.model_copy(
            update={
                "values": tuple(
                    cls._serialize_record_value(record_set.record_type, value)
                    for value in record_set.values
                )
            }
        )

    @classmethod
    def _serialize_record_value(cls, record_type: str, value: str) -> str:
        if record_type.upper() != "TXT":
            return value
        return cls._serialize_txt_value(value)

    @staticmethod
    def _serialize_txt_value(value: str) -> str:
        if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
            return value
        escaped_value = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped_value}"'

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
