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

- Postgres on `localhost:55432`
- PowerDNS Authoritative API on `localhost:8081`
- FastAPI backend on `localhost:8000`
- Vite frontend on `localhost:5173`

The backend container runs SQL migrations and creates a bootstrap admin user on startup.

## Bootstrap admin defaults

- username: `admin`
- password: `admin`

Override them with environment variables from [`deploy/.env.example`](../deploy/.env.example).

The backend reads `ZONIX_ENV`, `ZONIX_DATABASE_URL`, `ZONIX_BOOTSTRAP_ADMIN_USERNAME`, `ZONIX_BOOTSTRAP_ADMIN_PASSWORD`, `ZONIX_SESSION_SECRET_KEY`, `ZONIX_SESSION_TTL_SECONDS`, `ZONIX_POWERDNS_BACKEND_NAME`, `ZONIX_POWERDNS_API_URL`, `ZONIX_POWERDNS_API_KEY`, `ZONIX_POWERDNS_SERVER_ID`, and `ZONIX_POWERDNS_TIMEOUT_SECONDS`.

## Local-only workflows without Docker

Backend:

```bash
cd C:\Users\Ya\OneDrive\Desktop\Zonix
docker compose -f deploy/docker-compose.yml up -d postgres
docker compose -f deploy/docker-compose.yml up -d powerdns
cd backend
python -m app.migrations
python -m app.bootstrap
python -m uvicorn app.main:app --host 127.0.0.1 --port 8010
```

By default, local backend workflows connect to `postgresql://zonix:zonix@127.0.0.1:55432/zonix`.
That avoids collisions with an existing local Postgres on `5432`.
The local-only backend deliberately uses `127.0.0.1:8010` so it does not collide with the Docker stack on `localhost:8000`.

Frontend:

```bash
set VITE_API_BASE_URL=http://127.0.0.1:8010
npm install --prefix frontend
npm run dev:frontend
```

If you are using the Docker stack, do not run `npm run dev:backend` at the same time. The compose backend owns `localhost:8000`.

## Verification

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/ready`
- `POST http://localhost:8000/auth/login` with `{"username":"admin","password":"admin"}`
- `GET http://localhost:8000/auth/me` after login cookie is set
- `GET http://localhost:8000/backends` after login
- `GET http://localhost:8000/zones` after login
- `GET http://localhost:8000/zones/example.com` after login
- `GET http://localhost:8000/zones/example.com/records` after login
- open `http://localhost:5173`

Example login request:

```bash
curl -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

This returns a `zonix_session` cookie. Reuse it against `/auth/me`:

```bash
curl -i http://localhost:8000/auth/me \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

The same cookie can be used for the first protected list flows:

```bash
curl -i http://localhost:8000/backends \
  -H "Cookie: zonix_session=<paste-cookie-value>"

curl -i http://localhost:8000/zones \
  -H "Cookie: zonix_session=<paste-cookie-value>"

curl -i http://localhost:8000/zones/example.com \
  -H "Cookie: zonix_session=<paste-cookie-value>"

curl -i http://localhost:8000/zones/example.com/records \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

The bundled PowerDNS fixture serves two local zones from `deploy/powerdns/zones/`: `example.com` and `internal.example`.
On startup the backend attempts to import that zone inventory into the local database. Admins can re-sync on demand:

```bash
curl -i -X POST http://localhost:8000/admin/backends/powerdns-local/zones/sync \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

Zone grants are now persisted and manageable through the admin API:

```bash
curl -i http://localhost:8000/admin/grants/alice \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

## Current day-10 limitations

- auth currently covers only local accounts; OIDC arrives in days 16-20
- there is no CSRF protection yet because no state-changing UI/API flows beyond login/logout exist in the product
- DB migrations are SQL-file based scaffolding, not a full revision workflow yet
- PowerDNS integration is read-only; record mutations land in days 11-15
- zone grants require existing non-admin users; user provisioning UI/API is still out of scope for this milestone
- local backend dev mode runs without `--reload` because the Windows watcher path is not reliable in this environment
