# Zonix

Zonix is a DNS control plane for small infrastructure teams that need a safe UI and API over PowerDNS and RFC2136/BIND-compatible backends.

## Fixed stack

- frontend: React + TypeScript + TanStack Query + Zod
- backend: FastAPI + Pydantic

## Current status

The repository is at the initial implementation stage. The first iteration establishes:

- frozen v0.1 scope
- monorepo structure
- backend core domain model
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

The project currently uses Node's built-in test runner to avoid premature tooling decisions while the architecture is still being fixed.
