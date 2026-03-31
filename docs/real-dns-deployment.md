# Real DNS Deployment

Use this runbook when you want to test Zonix against real authoritative DNS infrastructure instead of the bundled demo stack.

This document assumes:

- you already validated the product locally through the demo Compose stack
- you have a non-production DNS zone or delegated subzone for testing
- you can provision either a PowerDNS API credential or an RFC2136/TSIG credential

## Safety rules

- do not start with a production apex zone
- use a dedicated test zone such as `zonix-lab.example.com`
- keep one bootstrap admin account until OIDC is confirmed working
- verify every write through preview first, then apply, then `dig`
- keep TTLs low in the test zone during validation

## Deployment shape

Minimum components:

- Postgres
- Zonix backend
- Zonix frontend

Optional:

- OIDC provider
- reverse proxy or ingress

External dependencies:

- PowerDNS authoritative API, or
- RFC2136-compatible DNS server such as BIND

## Environment baseline

Start from [deploy/.env.example](../deploy/.env.example) and create a real environment file such as `deploy/.env.real`.

These values must be overridden outside development:

- `ZONIX_ENV`
- `ZONIX_DATABASE_URL`
- `ZONIX_PUBLIC_BACKEND_BASE_URL`
- `ZONIX_ALLOWED_WEB_ORIGINS`
- `ZONIX_ALLOWED_HOSTS`
- `ZONIX_SESSION_SECRET_KEY`
- `ZONIX_BOOTSTRAP_ADMIN_PASSWORD`
- `ZONIX_SESSION_COOKIE_SECURE=true`

Recommended baseline:

```env
ZONIX_ENV=staging
ZONIX_DATABASE_URL=postgresql://zonix:<strong-password>@postgres.internal:5432/zonix
ZONIX_PUBLIC_BACKEND_BASE_URL=https://zonix-api.example.com
ZONIX_ALLOWED_WEB_ORIGINS=https://zonix.example.com
ZONIX_ALLOWED_HOSTS=zonix-api.example.com,localhost,127.0.0.1
ZONIX_SESSION_SECRET_KEY=<32+ random characters>
ZONIX_BOOTSTRAP_ADMIN_ENABLED=true
ZONIX_BOOTSTRAP_ADMIN_USERNAME=admin
ZONIX_BOOTSTRAP_ADMIN_PASSWORD=<strong-password>
ZONIX_SESSION_COOKIE_SECURE=true
```

## Option A: PowerDNS

Use this path when your authoritative DNS is PowerDNS and you can expose its HTTP API to Zonix.

Required settings:

```env
ZONIX_POWERDNS_BACKEND_ENABLED=true
ZONIX_POWERDNS_BACKEND_NAME=powerdns-prod
ZONIX_POWERDNS_API_URL=https://pdns-admin.example.com:8081
ZONIX_POWERDNS_API_KEY=<real-api-key>
ZONIX_POWERDNS_SERVER_ID=localhost
ZONIX_POWERDNS_TIMEOUT_SECONDS=5

ZONIX_BIND_BACKEND_ENABLED=false
```

PowerDNS checklist:

1. Confirm the API key can list zones outside Zonix.
2. Confirm the target zone already exists in PowerDNS.
3. Confirm Zonix can reach the API URL from the backend host or container network.

## Option B: RFC2136 / BIND

Use this path when you already operate BIND or another RFC2136-compatible authoritative path.

Required settings:

```env
ZONIX_BIND_BACKEND_ENABLED=true
ZONIX_BIND_BACKEND_NAME=bind-prod
ZONIX_BIND_SERVER_HOST=ns1.example.com
ZONIX_BIND_SERVER_PORT=53
ZONIX_BIND_TIMEOUT_SECONDS=5
ZONIX_BIND_AXFR_ENABLED=true
ZONIX_BIND_TSIG_KEY_NAME=zonix-key.
ZONIX_BIND_TSIG_SECRET=<base64-tsig-secret>
ZONIX_BIND_TSIG_ALGORITHM=hmac-sha256
ZONIX_BIND_ZONE_NAMES=zonix-lab.example.com

ZONIX_POWERDNS_BACKEND_ENABLED=false
```

RFC2136 checklist:

1. Confirm AXFR is allowed for the Zonix source IP if you expect read-through-AXFR.
2. Confirm TSIG credentials work with `nsupdate` before trying Zonix.
3. Confirm the zone is listed in `ZONIX_BIND_ZONE_NAMES`.

If AXFR is intentionally blocked, you can still use snapshots through `ZONIX_BIND_SNAPSHOT_FILE_MAP`, but that is a fallback path, not the preferred real-environment validation path.

## OIDC

For first deployment, local bootstrap auth is acceptable. Turn on OIDC after the basic DNS path is healthy.

Required OIDC settings:

- `ZONIX_OIDC_BOOTSTRAP_NAME`
- `ZONIX_OIDC_BOOTSTRAP_ISSUER`
- `ZONIX_OIDC_BOOTSTRAP_CLIENT_ID`
- `ZONIX_OIDC_BOOTSTRAP_CLIENT_SECRET`
- `ZONIX_OIDC_BOOTSTRAP_SCOPES`
- `ZONIX_OIDC_BOOTSTRAP_CLAIMS_MAPPING_RULES`

If you expose the frontend and backend on public URLs, make sure:

- `ZONIX_PUBLIC_BACKEND_BASE_URL` matches the public backend origin
- `ZONIX_ALLOWED_WEB_ORIGINS` includes the public frontend origin
- OIDC redirect URIs in the identity provider point to the public frontend flow used by Zonix

## Start sequence

If you keep using the Compose deployment assets, launch with an explicit environment file:

```bash
docker compose --env-file deploy/.env.real -f deploy/docker-compose.yml up -d --build
```

If you deploy backend and frontend outside Compose, the required application order is:

1. Postgres
2. backend
3. frontend

## First verification

Infrastructure:

- `GET /health`
- `GET /ready`
- `GET /metrics`

Authentication:

- local bootstrap admin login
- `GET /auth/me`
- if enabled, OIDC login and callback

DNS control plane:

- `GET /backends`
- `GET /zones`
- `GET /zones/<test-zone>`
- `GET /zones/<test-zone>/records`
- `POST /zones/<test-zone>/changes/preview`
- apply one test record create
- `GET /audit`

## Safe smoke workflow

Use one disposable record such as `zonix-smoke`.

1. Open the test zone.
2. Create preview for `zonix-smoke A 192.0.2.10`.
3. Apply the change.
4. Verify the record directly from authoritative DNS.
5. Verify the audit trail.
6. Delete the same record.
7. Verify authoritative DNS again.
8. Verify delete audit event.

Example verification:

```bash
dig @ns1.example.com zonix-smoke.zonix-lab.example.com A
```

## Curl smoke examples

Login:

```bash
curl -i -X POST https://zonix-api.example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<bootstrap-password>"}'
```

Read records:

```bash
curl -i https://zonix-api.example.com/zones/zonix-lab.example.com/records \
  -H "Cookie: zonix_session=<session-cookie>"
```

Preview create:

```bash
curl -i -X POST https://zonix-api.example.com/zones/zonix-lab.example.com/changes/preview \
  -H "Content-Type: application/json" \
  -H "Cookie: zonix_session=<session-cookie>; zonix_csrf_token=<csrf-cookie>" \
  -H "X-CSRF-Token: <csrf-cookie>" \
  -d '{"operation":"create","zoneName":"zonix-lab.example.com","name":"zonix-smoke","recordType":"A","ttl":60,"values":["192.0.2.10"]}'
```

## Rollback

If validation fails:

1. disable user access to the frontend
2. keep backend and Postgres for audit visibility
3. remove only the test records created during smoke
4. rotate bootstrap credentials if the environment was shared
5. fix reachability or credentials before the next run

## Exit criteria

You can treat the environment as ready for broader operator testing only after all of the following pass:

- backend health, readiness, and metrics are green
- one local admin can complete end-to-end CRUD in the test zone
- one OIDC user can log in and receive the correct role
- audit shows login, logout, and record mutation events
- direct DNS verification matches the UI/API result
