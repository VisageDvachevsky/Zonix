# Zonix Quickstart

## Prerequisites

- Docker Desktop or Docker Engine with Compose
- Node.js 24+
- Python 3.14+ for local backend workflows

## One-command local stack

From the repository root:

```bash
npm run compose:up
```

This starts:

- Postgres on `localhost:5432`
- FastAPI backend on `localhost:8000`
- Vite frontend on `localhost:5173`

The backend container runs SQL migrations and creates a bootstrap admin user on startup.

## Bootstrap admin defaults

- username: `admin`
- password: `admin`

Override them with environment variables from [`deploy/.env.example`](../deploy/.env.example).

The backend reads `ZONIX_ENV`, `ZONIX_DATABASE_URL`, `ZONIX_BOOTSTRAP_ADMIN_USERNAME`, and `ZONIX_BOOTSTRAP_ADMIN_PASSWORD`.

## Local-only workflows without Docker

Backend:

```bash
cd backend
python -m app.migrations
python -m app.bootstrap
uvicorn app.main:app --reload
```

Frontend:

```bash
npm install --prefix frontend
npm run dev:frontend
```

## Verification

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/ready`
- open `http://localhost:5173`

## Current day-5 limitations

- auth flows beyond bootstrap admin are not implemented yet
- DB migrations are SQL-file based scaffolding, not a full revision workflow yet
- frontend shell validates backend health but does not implement login or zone browsing yet
