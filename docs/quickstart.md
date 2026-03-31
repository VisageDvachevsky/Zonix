# Zonix Quickstart

Related docs:

- [Architecture](./architecture.md)
- [Auth modes](./auth-modes.md)
- [Backend adapters](./backend-adapters.md)
- [API examples](./api-examples.md)
- [Real DNS deployment](./real-dns-deployment.md)

## Prerequisites

- Docker Desktop or Docker Engine with Compose
- Node.js 24+
- Python 3.14+ for local backend workflows

## One-command local stack

From the repository root:

```bash
npm run compose:up
```

This starts, using the host ports currently declared in `deploy/demo.env` unless you override them through `ZONIX_HOST_*_PORT` in the shell:

- Postgres on `localhost:55432`
- PowerDNS Authoritative API on `localhost:8081`
- Keycloak-backed OIDC gateway on `localhost:9010`
- FastAPI backend on `localhost:8000`
- Vite frontend on `localhost:5173`

The backend container runs SQL migrations, provisions deterministic demo users, and bootstraps a deterministic OIDC provider configuration on startup.
The stack now reads its demo defaults from `deploy/demo.env`, so the compose file stays readable and the environment can be copied or adjusted without editing YAML first.
If any of the host ports are already occupied, change the `ZONIX_HOST_*_PORT` values in `deploy/demo.env` and rerun the same command.
The Compose backend now also derives `ZONIX_ALLOWED_WEB_ORIGINS` from the published frontend port, so OIDC login keeps working when the frontend is published on a non-default host port such as `25173`.

After the containers report healthy, run:

```bash
npm run compose:verify
```

This checks `health`, `ready`, `metrics`, the bootstrap admin login, and a protected zone listing through the demo stack.
`compose:verify` resolves the published backend port from the running Compose project, so it still targets the correct stack when you launched Docker with shell-level port overrides instead of editing `deploy/demo.env`.
If you need to inspect the actual published ports for the current stack, run:

```bash
docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port backend 8000
docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port frontend 5173
```

The current demo stack also includes the Day 47 performance pass: non-admin zone/backend reads and audit visibility now use indexed database lookups instead of loading full inventories into Python first.

## Screenshots

Zone inventory:

![Zone inventory](./screenshots/zones.png)

Zone detail:

![Zone detail](./screenshots/zone-detail.png)

Audit log:

![Audit log](./screenshots/audit-log.png)

## Optional BIND lab

Day-21 style BIND/RFC2136 fixtures live in a separate Compose override so the default PowerDNS demo path stays unchanged.

From the repository root:

```bash
npm run compose:up:bind-lab
```

This adds:

- BIND on `localhost:5301` for TCP and UDP DNS
- a TSIG-protected `lab.example` master zone
- backend bootstrap wiring for `bind-lab`
- demo grants so `alice` can edit `lab.example` and `bob` can read it

Relevant backend env values for the lab:

- `ZONIX_BIND_BACKEND_ENABLED=true`
- `ZONIX_BIND_BACKEND_NAME=bind-lab`
- `ZONIX_BIND_SERVER_HOST=bind`
- `ZONIX_BIND_ZONE_NAMES=lab.example`
- `ZONIX_BIND_TSIG_KEY_NAME=zonix-key.`

The BIND fixtures are stored in `deploy/bind/`, and the override file is `deploy/docker-compose.bind-lab.yml`.

Quick smoke check after startup:

```bash
curl -i http://localhost:8000/zones/lab.example \
  -H "Cookie: zonix_session=<paste-cookie-value>"

curl -i http://localhost:8000/zones/lab.example/records \
  -H "Cookie: zonix_session=<paste-cookie-value>"
```

## Dual-backend demo

To validate the day-25 milestone, start the base stack plus the BIND lab:

```bash
npm run compose:up:bind-lab
```

Then verify both backends through the same API session:

```bash
curl -c zonix-cookie.txt -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"local-dev-admin-change-me"}'

curl -b zonix-cookie.txt -i http://localhost:8000/zones

curl -b zonix-cookie.txt -i http://localhost:8000/zones/example.com/records

curl -b zonix-cookie.txt -i http://localhost:8000/zones/lab.example/records
```

The live integration proof for this milestone is:

```bash
cd backend
set ZONIX_POWERDNS_API_URL=http://127.0.0.1:8081
set ZONIX_POWERDNS_API_KEY=zonix-dev-powerdns-key
set ZONIX_POWERDNS_SERVER_ID=localhost
set ZONIX_BIND_SERVER_HOST=127.0.0.1
set ZONIX_BIND_SERVER_PORT=5301
set ZONIX_BIND_TSIG_KEY_NAME=zonix-key.
set ZONIX_BIND_TSIG_SECRET=2R3kJ2vclUO6hZOPJQ8eX8Vq3k2V+3h4E1W9mA6K0q8=
python -m pytest tests/test_dual_backend_flow_integration.py
```

## Bootstrap admin credentials

- username: `admin`
- password: `local-dev-admin-change-me`

## Demo local user credentials

- editor: `alice / editor` with write access to `example.com`
- viewer: `bob / viewer` with read access to `internal.example`

## Demo OIDC identities

The local compose stack runs a real Keycloak realm behind an OIDC gateway on `http://localhost:9010` and exposes deterministic browser identities:

- `oidc.admin`
- `oidc.editor`
- `oidc.viewer`

Browser passwords for the demo realm:

- `oidc.admin / admin`
- `oidc.editor / editor`
- `oidc.viewer / viewer`

Override them before exposing the stack anywhere outside your workstation. The local compose file and [`deploy/.env.example`](../deploy/.env.example) now use explicit development-only placeholders instead of `admin` / static session defaults baked into the backend.

The backend reads `ZONIX_ENV`, `ZONIX_DATABASE_URL`, `ZONIX_BOOTSTRAP_ADMIN_ENABLED`, `ZONIX_BOOTSTRAP_ADMIN_USERNAME`, `ZONIX_BOOTSTRAP_ADMIN_PASSWORD`, `ZONIX_BOOTSTRAP_USERS_JSON`, `ZONIX_BOOTSTRAP_ZONE_GRANTS_JSON`, `ZONIX_SESSION_SECRET_KEY`, `ZONIX_SESSION_COOKIE_SAMESITE`, `ZONIX_SESSION_COOKIE_SECURE`, `ZONIX_SESSION_TTL_SECONDS`, `ZONIX_ALLOWED_HOSTS`, `ZONIX_SECURITY_HEADERS_ENABLED`, `ZONIX_SECURITY_HEADERS_PERMISSIONS_POLICY`, `ZONIX_REQUEST_MAX_BODY_BYTES`, `ZONIX_LOGIN_RATE_LIMIT_ATTEMPTS`, `ZONIX_LOGIN_RATE_LIMIT_WINDOW_SECONDS`, `ZONIX_AUTH_OIDC_SELF_SIGNUP_ENABLED`, `ZONIX_OIDC_BOOTSTRAP_NAME`, `ZONIX_OIDC_BOOTSTRAP_ISSUER`, `ZONIX_OIDC_BOOTSTRAP_CLIENT_ID`, `ZONIX_OIDC_BOOTSTRAP_CLIENT_SECRET`, `ZONIX_OIDC_BOOTSTRAP_SCOPES`, `ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES`, `ZONIX_POWERDNS_BACKEND_NAME`, `ZONIX_POWERDNS_API_URL`, `ZONIX_POWERDNS_API_KEY`, `ZONIX_POWERDNS_SERVER_ID`, and `ZONIX_POWERDNS_TIMEOUT_SECONDS`.
Compose demo defaults for those values live in `deploy/demo.env`, while `deploy/.env.example` remains the template for non-compose or custom local runs.

Day 20 hardening defaults in the demo stack:

- bootstrap admin remains enabled in development and uses explicit dev-only credentials
- cookie-authenticated write requests require CSRF
- session cookies default to `SameSite=lax`
- OIDC self-signup is disabled by default until richer user provisioning UX lands

Day 46 hardening defaults in the demo stack:

- backend rejects unexpected `Host` headers outside `ZONIX_ALLOWED_HOSTS`
- API responses include `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control: no-store`
- write requests over `ZONIX_REQUEST_MAX_BODY_BYTES` fail with `413`
- repeated bad logins are throttled with `429` after `ZONIX_LOGIN_RATE_LIMIT_ATTEMPTS` within `ZONIX_LOGIN_RATE_LIMIT_WINDOW_SECONDS`

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
set ZONIX_DEV_PROXY_TARGET=http://127.0.0.1:8010
npm install --prefix frontend
npm run dev:frontend
```

The browser now talks to the frontend on `5173` or `4173` and Vite proxies `/api/*` to the backend target.
That avoids CORS drift between local-only backend runs and the Docker stack.

If you are using the Docker stack, do not run `npm run dev:backend` at the same time. The compose backend owns `localhost:8000`.

## Verification

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/ready`
- `GET http://localhost:8000/metrics`
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

Authentication settings are now exposed through a read-only endpoint for runtime inspection:

```bash
curl -i http://localhost:8000/auth/settings
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

curl -i "http://localhost:8000/auth/oidc/corp-oidc/login?return_to=http://localhost:5173"

curl -i "http://localhost:8000/auth/oidc/corp-oidc/callback?code=<provider-code>&state=<state-from-login-response>"
```

The demo compose stack already bootstraps `corp-oidc` against the local Keycloak realm through the OIDC gateway. For a different runtime, bootstrap an IdP configuration yourself:

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
