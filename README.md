# Zonix

Zonix is a DNS control plane for small infrastructure teams that need a safe UI and API over PowerDNS and RFC2136/BIND-compatible backends.

## Fixed stack

- frontend: React + TypeScript + TanStack Query + Zod
- backend: FastAPI + Pydantic

## Current status

The repository now covers the Day 1-10 milestone path:

- frozen v0.1 scope, domain model, and backend capability matrix
- React/FastAPI monorepo with CI, lint, format, and repository guardrails
- SQL migrations, bootstrap admin flow, and Docker Compose local stack
- policy enforcement across admin/editor/viewer roles
- persisted backend registry, zone inventory, and zone-level grants
- protected UI/API flow for backend list, zone list, zone detail, and record inventory
- read-only PowerDNS adapter mapped into backend-agnostic `Zone` and `RecordSet` models

What is still intentionally incomplete:

- OIDC and identity-provider flows arrive in later days
- write paths for DNS records arrive in days 11-15
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
