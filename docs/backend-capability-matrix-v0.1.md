# Zonix Backend Capability Matrix v0.1

## Purpose

This matrix turns the backend-agnostic adapter contract into an explicit artifact. UI, API, and policy code must consume backend capabilities from this matrix instead of assuming PowerDNS and RFC2136/BIND parity.

## Capability definitions

- `readZones`: backend can enumerate zones attached to its configuration.
- `readRecords`: backend can read normalized RRsets for a zone.
- `writeRecords`: backend can create, update, and delete supported RRsets.
- `discoverZones`: backend can auto-discover zones from the upstream system.
- `importSnapshot`: backend can ingest zones through snapshot or imported state rather than live discovery.
- `commentsMetadata`: backend exposes record comments or adjacent metadata in a meaningful way.
- `axfr`: backend can read zone content through AXFR.
- `rfc2136Update`: backend can mutate records through RFC2136 dynamic updates.

## v0.1 backend matrix

| Backend type | readZones | readRecords | writeRecords | discoverZones | importSnapshot | commentsMetadata | axfr | rfc2136Update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `powerdns` | yes | yes | yes | yes | no | yes | no | no |
| `rfc2136-bind` | limited | yes | yes | no | yes | no | optional | yes |

## Notes by backend

### PowerDNS

- Expected to provide the strongest v0.1 read/write story.
- Zone and record access are native capabilities.
- Discovery is supported through the backend API.
- Comments and metadata are modeled as supported, even though the core model keeps that detail out of shared entities in v0.1.

### RFC2136/BIND-compatible

- Write path is honest only when RFC2136 update is configured and reachable.
- Read path may rely on AXFR, but AXFR is optional and must not be assumed.
- When AXFR is unavailable, the adapter must expose `importSnapshot` and document the fallback behavior.
- `readZones` is marked limited because manual registration may still be required for v0.1.

## Engineering rules

- Every backend registration must persist its capability set explicitly.
- UI badges and disabled actions must derive from stored capabilities, not backend type string checks.
- Service-layer behavior must gate feature access on capabilities before calling an adapter.
- Any new backend added after v0.1 must extend this matrix before implementation starts.
