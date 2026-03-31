# Zonix Architecture

## Runtime shape

Zonix v0.1 is split into two deployable applications:

- `frontend/`: React + TypeScript operator UI
- `backend/`: FastAPI control-plane API

The backend talks to four classes of systems:

- PostgreSQL for users, grants, backend registry, sessions, and audit data
- PowerDNS Authoritative API for the primary read/write adapter
- RFC2136/BIND-compatible servers for the secondary adapter path
- OIDC providers for browser authentication

## Core flow

1. The browser loads the frontend shell.
2. The frontend authenticates with the backend using local credentials or OIDC.
3. The backend resolves the current user, global role, and zone-level grants.
4. The frontend fetches backends, visible zones, record sets, and audit events through the OpenAPI-backed client.
5. Mutating record flows go through preview first, then apply.
6. The backend writes to the selected adapter and persists an audit event with actor, zone, backend, and payload context.

## Main domain objects

- `User`: local or OIDC-backed principal with `admin`, `editor`, or `viewer` role
- `PermissionGrant`: zone-level read/write access
- `IdentityProvider`: generic OIDC configuration
- `Backend`: named DNS backend with capability flags
- `Zone`: backend-owned namespace visible in the UI/API
- `RecordSet`: normalized RRset used across adapters
- `ChangeSet`: preview/apply payload for record mutations
- `AuditEvent`: immutable event log for login and record changes

## Authentication

Local auth:

- username/password validated against the backend user store
- cookie session issued by FastAPI
- CSRF token mirrored into a cookie and required for state-changing requests

OIDC auth:

- frontend starts login through `/auth/oidc/{provider}/login`
- backend signs state, exchanges the callback code, maps claims/groups, and creates or updates the user session
- claims mapping can elevate role and zone grants without hardcoding provider-specific logic into the frontend

## DNS adapter model

PowerDNS path:

- zone reads through the PowerDNS HTTP API
- record create/update/delete through RRset write calls
- capability flags expose discovery, reads, writes, and metadata support

RFC2136/BIND-compatible path:

- zones are registered manually or imported into the inventory
- reads happen through AXFR or declared snapshot fallback
- writes happen through RFC2136 update messages
- limitations are explicit in UI and docs instead of being hidden behind fake parity

## Deployment contours

Local/demo:

- `deploy/docker-compose.yml` starts Postgres, PowerDNS, Keycloak, OIDC gateway, backend, and frontend
- `deploy/docker-compose.bind-lab.yml` adds a BIND lab for RFC2136 validation

Kubernetes:

- `deploy/helm/zonix` provides the minimal Helm story for frontend/backend deployment
- external dependencies stay explicit: database, PowerDNS, and OIDC services must already exist
- backend should remain single-replica until migrations/bootstrap are split into a dedicated Job

## Operational endpoints

- `/health`: process-level health
- `/ready`: dependency-aware readiness
- `/metrics`: basic Prometheus-style counters and latency histograms

## UI surfaces

- zone inventory
- zone detail with searchable/sortable record table
- preview/apply mutations
- audit log with actor/zone filters
- admin pages for users, grants, backends, and identity providers
