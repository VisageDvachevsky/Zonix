# Zonix

Zonix is a DNS control plane for small infrastructure teams that need a safe UI and API over PowerDNS and RFC2136/BIND-compatible backends.

## Fixed stack

- frontend: React + TypeScript + TanStack Query + Zod
- backend: FastAPI + Pydantic

## Current status

The repository now covers the Day 1-18 milestone path:

- frozen v0.1 scope, domain model, and backend capability matrix
- React/FastAPI monorepo with CI, lint, format, and repository guardrails
- SQL migrations, bootstrap admin flow, and Docker Compose local stack
- reproducible bootstrap path for an OIDC provider via environment-driven CLI setup
- policy enforcement across admin/editor/viewer roles
- persisted backend registry, zone inventory, and zone-level grants
- protected UI/API flow for backend list, zone list, zone detail, record inventory, record mutations, and audit listing
- PowerDNS adapter mapped into backend-agnostic `Zone` and `RecordSet` models for both read and write flows
- audit trail for successful local login and record create/update/delete events with actor, zone, backend, and payload context
- `ChangeSet` preview for record mutations with before/after snapshots, conflict detection, and basic optimistic locking via record version tokens
- live PowerDNS API flow coverage for `login -> open zone -> edit record -> audit` plus an internal demo path in quickstart
- `IdentityProvider` foundation for generic OIDC with issuer, client credentials, scopes, and claims-mapping configuration
- generic OIDC login start/callback flow with signed state, token exchange, userinfo resolution, session issuance, and baseline viewer provisioning
- OIDC claims/groups mapping into global role and zone-level grants during callback

What is still intentionally incomplete:

- backend/admin UX for managing IdP configs arrives in day 19
- deeper PowerDNS integration beyond the day-15 flow remains for later milestones
- sync is explicit and minimal today: startup attempts an initial zone import, and admins can trigger backend zone sync on demand

## Monorepo layout

- `backend/` - control plane backend and adapters
- `frontend/` - operator UI
- `docs/` - PRD, architecture notes, quickstart
- `deploy/` - local and demo deployment assets
- `tests/` - repository-level TDD guardrails

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
