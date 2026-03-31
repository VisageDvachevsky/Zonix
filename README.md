# Zonix

Zonix is a DNS control plane for small infrastructure teams that need a safe UI and API over PowerDNS and RFC2136/BIND-compatible backends.

## Fixed stack

- frontend: React + TypeScript + TanStack Query + Zod
- backend: FastAPI + Pydantic

## Current status

The repository now covers the MVP path through Day 49:

- frozen v0.1 scope, domain model, and backend capability matrix
- React/FastAPI monorepo with CI, lint, format, and repository guardrails
- SQL migrations, bootstrap admin flow, and Docker Compose local stack
- minimal Helm chart for frontend/backend deployment with explicit external dependency wiring
- separate day-21-style BIND lab fixtures in Compose override form
- reproducible bootstrap path for deterministic local demo users plus a local Keycloak-backed OIDC demo realm
- policy enforcement across admin/editor/viewer roles
- persisted backend registry, zone inventory, and zone-level grants
- protected UI/API flow for backend list, zone list, zone detail, record inventory, record mutations, and audit listing
- PowerDNS adapter mapped into backend-agnostic `Zone` and `RecordSet` models for both read and write flows
- RFC2136/BIND adapter with manual zone inventory, AXFR read path, RFC2136 write path, and snapshot fallback wiring
- audit trail for successful local login and record create/update/delete events with actor, zone, backend, and payload context
- `ChangeSet` preview for record mutations with before/after snapshots, conflict detection, and basic optimistic locking via record version tokens
- live PowerDNS API flow coverage for `login -> open zone -> edit record -> audit` plus an internal demo path in quickstart
- `IdentityProvider` foundation for generic OIDC with issuer, client credentials, scopes, and claims-mapping configuration
- generic OIDC login start/callback flow with signed state, token exchange, userinfo resolution, session issuance, and browser redirect back into the frontend
- OIDC claims/groups mapping into global role and zone-level grants during callback
- hardened auth defaults with explicit session cookie settings, CSRF-protected cookie auth, login failure/logout audit events, disabled OIDC self-signup by default, and deterministic bootstrap admin defaults for development
- operational hardening with `/health`, `/ready`, `/metrics`, structured request logging, strict security response headers, trusted host validation, request body size limits, and login rate limiting
- performance-oriented backend reads for non-admin zone/backend discovery and audit visibility, backed by targeted Postgres indexes for the hot day-31-to-day-47 flows
- release-facing artifacts for the RC phase: release notes, upgrade notes, and known limitations
- live Playwright coverage for local login, OIDC login, zone navigation, record edit flows, and audit visibility on the main release path

What is still intentionally incomplete:

- deeper PowerDNS integration beyond the day-15 flow remains for later milestones
- sync is explicit and minimal today: startup attempts an initial zone import, and admins can trigger backend zone sync on demand
- full user lifecycle management still lands later: day 20 disables self-signup, but richer user provisioning/admin UX is still planned for the RBAC UI milestone

## Monorepo layout

- `backend/` - control plane backend and adapters
- `frontend/` - operator UI
- `docs/` - PRD, architecture notes, quickstart
- `deploy/` - local and demo deployment assets
- `tests/` - repository-level TDD guardrails

## Documentation

- [`docs/quickstart.md`](docs/quickstart.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/auth-modes.md`](docs/auth-modes.md)
- [`docs/backend-adapters.md`](docs/backend-adapters.md)
- [`docs/api-examples.md`](docs/api-examples.md)
- [`docs/real-dns-deployment.md`](docs/real-dns-deployment.md)
- [`docs/release-notes-v0.1.0-rc1.md`](docs/release-notes-v0.1.0-rc1.md)
- [`docs/release-notes-v0.1.0-rc2.md`](docs/release-notes-v0.1.0-rc2.md)
- [`docs/upgrade-notes-v0.1.0-rc1.md`](docs/upgrade-notes-v0.1.0-rc1.md)
- [`docs/known-limitations-v0.1.0-rc1.md`](docs/known-limitations-v0.1.0-rc1.md)
- [`docs/closed-beta-checklist-v0.1.0-rc1.md`](docs/closed-beta-checklist-v0.1.0-rc1.md)
- [`docs/closed-beta-runbook-v0.1.0-rc1.md`](docs/closed-beta-runbook-v0.1.0-rc1.md)

## Development

Run the current test suite:

```bash
npm test
```

Lint and format checks:

```bash
npm run lint
npm run format:check
```

Start the local stack:

```bash
npm run compose:up
```

Quickstart details live in [`docs/quickstart.md`](docs/quickstart.md).
