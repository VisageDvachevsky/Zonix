from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from importlib import import_module
from pathlib import Path
from typing import Any

from app.domain.models import RecordSet, Zone
from app.zone_reads import UpstreamReadError


class RFC2136ClientError(RuntimeError):
    """Base RFC2136/BIND client error."""


class RFC2136ConnectionError(RFC2136ClientError):
    """RFC2136/BIND upstream could not be reached."""


class RFC2136ResponseError(RFC2136ClientError):
    """RFC2136/BIND upstream rejected the request."""


RFC2136AXFRFetcher = Callable[[str], object]
RFC2136UpdateSender = Callable[[Mapping[str, Any]], None]
SnapshotReader = Callable[[], object]


@dataclass(frozen=True)
class _DNSModules:
    query: Any
    rcode: Any
    rdatatype: Any
    tsigkeyring: Any
    update: Any
    zone: Any


class RFC2136Client:
    def __init__(
        self,
        server_host: str,
        port: int = 53,
        timeout_seconds: float = 5.0,
        tsig_key_name: str = "",
        tsig_secret: str = "",
        tsig_algorithm: str = "hmac-sha256",
        axfr_fetcher: RFC2136AXFRFetcher | None = None,
        update_sender: RFC2136UpdateSender | None = None,
    ) -> None:
        if not server_host:
            raise ValueError("RFC2136 server host must not be empty")
        if port <= 0 or port > 65535:
            raise ValueError("RFC2136 port must be between 1 and 65535")
        if timeout_seconds <= 0:
            raise ValueError("RFC2136 timeout must be positive")

        self.server_host = server_host
        self.port = port
        self.timeout_seconds = timeout_seconds
        self.tsig_key_name = tsig_key_name.strip()
        self.tsig_secret = tsig_secret.strip()
        self.tsig_algorithm = tsig_algorithm.strip() or "hmac-sha256"
        self.axfr_fetcher = axfr_fetcher or self._default_axfr_fetcher
        self.update_sender = update_sender or self._default_update_sender

    def transfer_zone(self, zone_name: str) -> tuple[RecordSet, ...]:
        payload = self.axfr_fetcher(self._normalize_dns_name(zone_name))
        return self.map_zone_payload(zone_name, payload)

    def map_zone_payload(self, zone_name: str, payload: object) -> tuple[RecordSet, ...]:
        normalized_zone_name = self._normalize_dns_name(zone_name)

        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")

        if isinstance(payload, str):
            payload = self._parse_zone_text(normalized_zone_name, payload)

        if isinstance(payload, tuple) and all(isinstance(item, RecordSet) for item in payload):
            return tuple(sorted(payload, key=lambda record: (record.name, record.record_type)))
        if isinstance(payload, list) and all(isinstance(item, RecordSet) for item in payload):
            return tuple(sorted(payload, key=lambda record: (record.name, record.record_type)))

        return self._map_zone_object(normalized_zone_name, payload)

    def replace_record_set(self, record_set: RecordSet) -> RecordSet:
        self._send_update(
            {
                "operation": "replace",
                "zone_name": self._normalize_dns_name(record_set.zone_name),
                "name": self._relative_record_name(record_set.zone_name, record_set.name),
                "record_type": record_set.record_type.upper(),
                "ttl": record_set.ttl,
                "values": tuple(record_set.values),
            }
        )
        return record_set

    def delete_record_set(self, zone_name: str, name: str, record_type: str) -> None:
        self._send_update(
            {
                "operation": "delete",
                "zone_name": self._normalize_dns_name(zone_name),
                "name": self._relative_record_name(zone_name, name),
                "record_type": record_type.upper(),
            }
        )

    def _send_update(self, operation: Mapping[str, Any]) -> None:
        if not self.tsig_key_name or not self.tsig_secret:
            raise RFC2136ClientError(
                "RFC2136 write path requires TSIG key name and secret to be configured"
            )
        self.update_sender(operation)

    def _default_axfr_fetcher(self, zone_name: str) -> object:
        dns = self._load_dns_modules()
        try:
            transfer = dns.query.xfr(
                where=self.server_host,
                zone=zone_name,
                port=self.port,
                timeout=self.timeout_seconds,
                lifetime=self.timeout_seconds,
                relativize=False,
                keyring=self._build_keyring(dns),
                keyname=self.tsig_key_name or None,
                keyalgorithm=self.tsig_algorithm,
            )
            return dns.zone.from_xfr(transfer, relativize=False)
        except OSError as error:
            raise RFC2136ConnectionError(str(error)) from error
        except Exception as error:
            raise RFC2136ResponseError(str(error)) from error

    def _default_update_sender(self, operation: Mapping[str, Any]) -> None:
        dns = self._load_dns_modules()
        try:
            message = dns.update.Update(
                operation["zone_name"],
                keyring=self._build_keyring(dns),
                keyname=self.tsig_key_name,
                keyalgorithm=self.tsig_algorithm,
            )
            if operation["operation"] == "replace":
                message.replace(
                    operation["name"],
                    operation["ttl"],
                    operation["record_type"],
                    *operation["values"],
                )
            elif operation["operation"] == "delete":
                message.delete(operation["name"], operation["record_type"])
            else:
                raise RFC2136ClientError(f"unsupported RFC2136 operation: {operation['operation']}")

            response = dns.query.tcp(
                message,
                self.server_host,
                port=self.port,
                timeout=self.timeout_seconds,
            )
        except OSError as error:
            raise RFC2136ConnectionError(str(error)) from error
        except RFC2136ClientError:
            raise
        except Exception as error:
            raise RFC2136ResponseError(str(error)) from error

        response_code = response.rcode()
        if response_code != 0:
            raise RFC2136ResponseError(
                f"RFC2136 update rejected with {dns.rcode.to_text(response_code)}"
            )

    def _parse_zone_text(self, zone_name: str, raw_zone: str) -> object:
        dns = self._load_dns_modules()
        try:
            return dns.zone.from_text(
                raw_zone,
                origin=f"{zone_name}.",
                relativize=False,
            )
        except Exception as error:
            raise RFC2136ResponseError(f"snapshot parse failed: {error}") from error

    def _map_zone_object(self, zone_name: str, payload: object) -> tuple[RecordSet, ...]:
        origin = getattr(payload, "origin", None)
        nodes = getattr(payload, "nodes", None)
        if origin is None or not isinstance(nodes, Mapping):
            raise RFC2136ClientError("RFC2136 zone payload is not a supported zone object")

        normalized_origin = self._normalize_dns_name(self._name_to_text(origin))
        if normalized_origin != zone_name:
            raise RFC2136ClientError(
                "RFC2136 zone payload origin mismatch: "
                f"expected '{zone_name}', got '{normalized_origin}'"
            )

        record_sets: list[RecordSet] = []
        for node_name, node in nodes.items():
            absolute_name = self._normalize_dns_name(
                self._name_to_text(self._derelativize_name(node_name, origin))
            )
            rr_name = self._normalize_record_name(absolute_name, zone_name)

            rdatasets = getattr(node, "rdatasets", ())
            for rdataset in rdatasets:
                ttl = getattr(rdataset, "ttl", None)
                if not isinstance(ttl, int) or ttl <= 0:
                    raise RFC2136ClientError("RFC2136 zone payload contains invalid TTL")

                values = tuple(self._rdata_to_text(rdata, origin) for rdata in rdataset)
                if not values:
                    continue

                record_sets.append(
                    RecordSet(
                        zone_name=zone_name,
                        name=rr_name,
                        record_type=self._rdataset_type_text(rdataset),
                        ttl=ttl,
                        values=values,
                    )
                )

        return tuple(sorted(record_sets, key=lambda record: (record.name, record.record_type)))

    def _rdataset_type_text(self, rdataset: object) -> str:
        rdtype = getattr(rdataset, "rdtype", None)
        if isinstance(rdtype, str) and rdtype.strip():
            return rdtype.strip().upper()

        dns = self._load_dns_modules()
        try:
            return str(dns.rdatatype.to_text(rdtype)).upper()
        except Exception as error:
            raise RFC2136ClientError("RFC2136 zone payload contains invalid record type") from error

    @staticmethod
    def _rdata_to_text(rdata: object, origin: object) -> str:
        to_text = getattr(rdata, "to_text", None)
        if not callable(to_text):
            raise RFC2136ClientError("RFC2136 zone payload contains invalid rdata entries")

        try:
            value = to_text(origin=origin, relativize=False)
        except TypeError:
            value = to_text()
        if not isinstance(value, str) or not value:
            raise RFC2136ClientError("RFC2136 zone payload produced an invalid record value")
        return value

    @staticmethod
    def _derelativize_name(name: object, origin: object) -> object:
        derelativize = getattr(name, "derelativize", None)
        if callable(derelativize):
            return derelativize(origin)
        return name

    @staticmethod
    def _name_to_text(name: object) -> str:
        to_text = getattr(name, "to_text", None)
        if not callable(to_text):
            raise RFC2136ClientError("RFC2136 zone payload contains invalid names")

        try:
            value = to_text(omit_final_dot=False)
        except TypeError:
            value = to_text()
        if not isinstance(value, str) or not value:
            raise RFC2136ClientError("RFC2136 zone payload contains invalid names")
        return value

    def _build_keyring(self, dns: _DNSModules) -> object | None:
        if not self.tsig_key_name or not self.tsig_secret:
            return None
        return dns.tsigkeyring.from_text({self.tsig_key_name: self.tsig_secret})

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
    def _relative_record_name(cls, zone_name: str, rr_name: str) -> str:
        normalized_zone_name = cls._normalize_dns_name(zone_name)
        normalized_rr_name = cls._normalize_dns_name(rr_name)
        if normalized_rr_name == "@":
            return "@"
        suffix = f".{normalized_zone_name}"
        if normalized_rr_name == normalized_zone_name:
            return "@"
        if normalized_rr_name.endswith(suffix):
            return normalized_rr_name[: -len(suffix)]
        return normalized_rr_name

    @staticmethod
    def _load_dns_modules() -> _DNSModules:
        try:
            return _DNSModules(
                query=import_module("dns.query"),
                rcode=import_module("dns.rcode"),
                rdatatype=import_module("dns.rdatatype"),
                tsigkeyring=import_module("dns.tsigkeyring"),
                update=import_module("dns.update"),
                zone=import_module("dns.zone"),
            )
        except ModuleNotFoundError as error:
            raise RFC2136ClientError(
                "dnspython is required for RFC2136/BIND support"
            ) from error


class RFC2136Adapter:
    def __init__(
        self,
        backend_name: str,
        zone_names: tuple[str, ...],
        client: RFC2136Client,
        *,
        axfr_enabled: bool = True,
        snapshot_readers: Mapping[str, SnapshotReader] | None = None,
    ) -> None:
        self.backend_name = backend_name
        self.client = client
        self.axfr_enabled = axfr_enabled
        self.zone_names = tuple(
            sorted({self._normalize_dns_name(zone_name) for zone_name in zone_names if zone_name})
        )
        self.snapshot_readers = {
            self._normalize_dns_name(zone_name): reader
            for zone_name, reader in (snapshot_readers or {}).items()
        }

    def list_zones(self) -> tuple[Zone, ...]:
        return tuple(
            Zone(name=zone_name, backend_name=self.backend_name) for zone_name in self.zone_names
        )

    def get_zone(self, zone_name: str) -> Zone | None:
        normalized_zone_name = self._normalize_dns_name(zone_name)
        if normalized_zone_name not in self.zone_names:
            return None
        return Zone(name=normalized_zone_name, backend_name=self.backend_name)

    def list_records(self, zone_name: str) -> tuple[RecordSet, ...]:
        normalized_zone_name = self._normalize_dns_name(zone_name)
        if normalized_zone_name not in self.zone_names:
            return ()

        errors: list[str] = []
        if self.axfr_enabled:
            try:
                return self.client.transfer_zone(normalized_zone_name)
            except RFC2136ClientError as error:
                errors.append(str(error))

        snapshot_reader = self.snapshot_readers.get(normalized_zone_name)
        if snapshot_reader is not None:
            try:
                return self.client.map_zone_payload(normalized_zone_name, snapshot_reader())
            except RFC2136ClientError as error:
                errors.append(str(error))

        if errors:
            raise UpstreamReadError(self.backend_name, "; ".join(errors))
        raise UpstreamReadError(
            self.backend_name,
            f"zone '{normalized_zone_name}' does not have an AXFR or snapshot read path configured",
        )

    def create_record_set(self, record_set: RecordSet) -> RecordSet:
        try:
            return self.client.replace_record_set(record_set)
        except RFC2136ClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

    def update_record_set(self, record_set: RecordSet) -> RecordSet:
        try:
            return self.client.replace_record_set(record_set)
        except RFC2136ClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

    def delete_record_set(self, zone_name: str, name: str, record_type: str) -> None:
        try:
            self.client.delete_record_set(zone_name, name, record_type)
        except RFC2136ClientError as error:
            raise UpstreamReadError(self.backend_name, str(error)) from error

    @staticmethod
    def _normalize_dns_name(value: str) -> str:
        return value[:-1] if value.endswith(".") else value


def build_file_snapshot_readers(
    snapshot_file_map: Mapping[str, str],
) -> dict[str, SnapshotReader]:
    readers: dict[str, SnapshotReader] = {}
    for zone_name, raw_path in snapshot_file_map.items():
        path = Path(raw_path)
        readers[zone_name] = lambda path=path: path.read_text(encoding="utf-8")
    return readers
