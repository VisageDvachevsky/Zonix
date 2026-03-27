# Zonix

Zonix is a DNS control plane for small infrastructure teams that need a safe UI and API over PowerDNS and RFC2136/BIND-compatible backends.

## Fixed stack

- frontend: React + TypeScript + TanStack Query + Zod
- backend: FastAPI + Pydantic

## Current status

The repository is at the initial implementation stage. Days 1-5 now establish:

- frozen v0.1 scope
- backend capability matrix
- monorepo structure
- backend core domain model
- frontend shell with TanStack Query + Zod contract validation
- migrations, bootstrap admin flow, and Docker Compose local stack
- TDD baseline with executable tests

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
