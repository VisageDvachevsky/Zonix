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

## Bootstrap admin credentials

- username: `admin`
- password: `local-dev-admin-change-me`

Override them before exposing the stack anywhere outside your workstation. The local compose file and [`deploy/.env.example`](../deploy/.env.example) now use explicit development-only placeholders instead of `admin` / static session defaults baked into the backend.

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
- `POST http://localhost:8000/auth/login` with `{"username":"admin","password":"local-dev-admin-change-me"}`
- `GET http://localhost:8000/auth/me` after login cookie is set
- `GET http://localhost:8000/backends` after login
- `GET http://localhost:8000/zones` after login
- `GET http://localhost:8000/zones/example.com` after login
- `GET http://localhost:8000/zones/example.com/records` after login
- `POST http://localhost:8000/zones/example.com/records` after login
- `PUT http://localhost:8000/zones/example.com/records` after login
- `DELETE http://localhost:8000/zones/example.com/records` after login
- `POST http://localhost:8000/zones/example.com/changes/preview` after login
- `GET http://localhost:8000/audit` after login
- open `http://localhost:5173`

Example login request:

```bash
curl -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"local-dev-admin-change-me"}'
```

This returns a `zonix_session` cookie plus a `zonix_csrf_token` cookie. Reuse the session cookie against `/auth/me`:

```bash
curl -i http://localhost:8000/auth/me \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

For state-changing requests made with `curl`, send both cookies and mirror the CSRF token into `X-CSRF-Token`:

```bash
curl -i -X POST http://localhost:8000/auth/logout \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>"
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

PowerDNS write-path is now live for RRset create, update, and delete:

```bash
curl -i -X POST http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"api","recordType":"TXT","ttl":300,"values":["\"created\""]}'

curl -i -X PUT http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"www","recordType":"A","ttl":600,"values":["192.0.2.99"]}'

curl -i -X DELETE http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"api","recordType":"TXT"}'
```

Change preview and optimistic locking are now available through `ChangeSet` preview plus `expectedVersion` on write requests:

```bash
curl -i -X POST http://localhost:8000/zones/example.com/changes/preview \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"operation":"update","zoneName":"example.com","name":"www","recordType":"A","ttl":600,"values":["192.0.2.99"],"expectedVersion":"<current-version-from-record-list>"}'

curl -i -X PUT http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"www","recordType":"A","ttl":600,"values":["192.0.2.99"],"expectedVersion":"<current-version-from-record-list>"}'
```

Audit is now available through the protected API and includes successful logins plus record mutations:

```bash
curl -i http://localhost:8000/audit \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

## Day 15 demo flow

The current internal demo path is the first fully useful operator loop:

1. log in with the bootstrap admin
2. open a live zone and list its current record sets
3. create or update a record through the protected API
4. verify the resulting audit event

One reproducible curl flow:

```bash
curl -c zonix-cookie.txt -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"local-dev-admin-change-me"}'

curl -b zonix-cookie.txt -i http://localhost:8000/zones/example.com

curl -b zonix-cookie.txt -i http://localhost:8000/zones/example.com/records

curl -b zonix-cookie.txt -i -X POST http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token-from-zonix-cookie.txt>" \
  -d '{"zoneName":"example.com","name":"day15-demo","recordType":"TXT","ttl":300,"values":["\"created\""]}'

curl -b zonix-cookie.txt -i -X PUT http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token-from-zonix-cookie.txt>" \
  -d '{"zoneName":"example.com","name":"day15-demo","recordType":"TXT","ttl":600,"values":["\"updated\""],"expectedVersion":"<version-from-create-response>"}'

curl -b zonix-cookie.txt -i http://localhost:8000/audit

curl -b zonix-cookie.txt -i -X DELETE http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token-from-zonix-cookie.txt>" \
  -d '{"zoneName":"example.com","name":"day15-demo","recordType":"TXT"}'
```

The bundled PowerDNS fixture now runs on a writable SQLite-backed PowerDNS store seeded from `deploy/powerdns/init/seed.sql`.
It ships with two local zones: `example.com` and `internal.example`.
On startup the backend attempts to import that zone inventory into the local database. Admins can re-sync on demand:

```bash
curl -i -X POST http://localhost:8000/admin/backends/powerdns-local/zones/sync \
  -H "Cookie: zonix_session=<paste-session-cookie>; zonix_csrf_token=<paste-csrf-cookie>" \
  -H "X-CSRF-Token: <paste-csrf-cookie>"
```

Zone grants are now persisted and manageable through the admin API:

```bash
curl -i http://localhost:8000/admin/grants/alice \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

If the first inventory sync fails, `/ready` returns `degraded` and includes `inventorySyncError` in the JSON payload instead of failing silently.

There is also a live adapter test that targets a real PowerDNS API:

```bash
cd backend
set ZONIX_POWERDNS_API_URL=http://127.0.0.1:8081
set ZONIX_POWERDNS_API_KEY=zonix-dev-powerdns-key
set ZONIX_POWERDNS_SERVER_ID=localhost
python -m pytest tests/test_powerdns_live_integration.py
```

There is now a day-15 live API integration test for the full operator flow:

```bash
cd backend
set ZONIX_POWERDNS_API_URL=http://127.0.0.1:8081
set ZONIX_POWERDNS_API_KEY=zonix-dev-powerdns-key
set ZONIX_POWERDNS_SERVER_ID=localhost
python -m unittest tests.test_powerdns_flow_integration
```

OIDC login start and callback are now exposed through the auth API:

```bash
curl -i http://localhost:8000/auth/oidc/providers

curl -i http://localhost:8000/auth/oidc/corp-oidc/login

curl -i "http://localhost:8000/auth/oidc/corp-oidc/callback?code=<provider-code>&state=<state-from-login-response>"
```

Before using those endpoints in a real runtime, bootstrap an IdP configuration:

```bash
set ZONIX_OIDC_BOOTSTRAP_NAME=corp-oidc
set ZONIX_OIDC_BOOTSTRAP_ISSUER=https://issuer.example
set ZONIX_OIDC_BOOTSTRAP_CLIENT_ID=zonix-ui
set ZONIX_OIDC_BOOTSTRAP_CLIENT_SECRET=super-secret
set ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES={"usernameClaim":"preferred_username","rolesClaim":"groups","adminGroups":["dns-admins"],"zoneEditorPattern":"zone-{zone}-editors","zoneViewerPattern":"zone-{zone}-viewers"}
npm run bootstrap:oidc
```

Claims mapping rules are now applied during OIDC callback. A provider can promote groups into a global role and zone grants through `claimsMappingRules`, for example:

```json
{
  "usernameClaim": "preferred_username",
  "rolesClaim": "groups",
  "adminGroups": ["dns-admins"],
  "zoneEditorPattern": "zone-{zone}-editors",
  "zoneViewerPattern": "zone-{zone}-viewers"
}
```

## Current auth hardening status

- state-changing cookie-authenticated API calls now require `X-CSRF-Token` that matches the `zonix_csrf_token` cookie
- OIDC login requires `userinfo` claims or a future implementation of signed `id_token` validation; unsigned payload decoding is no longer accepted
- DB migrations are SQL-file based scaffolding, not a full revision workflow yet
- PowerDNS writes, audit trail, and backend diff preview are live, but the dedicated preview/apply UX lands later in the UI track
- zone grants require existing non-admin users; user provisioning UI/API is still out of scope for this milestone
- local backend dev mode runs without `--reload` because the Windows watcher path is not reliable in this environment
