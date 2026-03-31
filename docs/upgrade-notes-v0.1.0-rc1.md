# Zonix v0.1.0-rc1 Upgrade Notes

## When These Notes Apply

Use this guide when moving an existing local or test deployment forward to the `v0.1.0-rc1` release candidate from an earlier repository snapshot.

## Before You Upgrade

1. Back up the Postgres database if you care about existing local data.
2. Save any overridden environment variables or compose overrides you already rely on.
3. Review the new release-facing docs before changing a shared test environment.

## Required Environment Review

Earlier snapshots may not define the newer auth and hardening settings. Review these variables before starting the upgraded stack:

- `ZONIX_SESSION_SECRET_KEY`
- `ZONIX_ALLOWED_HOSTS`
- `ZONIX_SECURITY_HEADERS_ENABLED`
- `ZONIX_SECURITY_HEADERS_PERMISSIONS_POLICY`
- `ZONIX_REQUEST_MAX_BODY_BYTES`
- `ZONIX_LOGIN_RATE_LIMIT_ATTEMPTS`
- `ZONIX_LOGIN_RATE_LIMIT_WINDOW_SECONDS`
- `ZONIX_DATABASE_CONNECT_TIMEOUT_SECONDS`

For compose-based demo environments, compare your settings to [demo.env](C:/Users/Ya/OneDrive/Desktop/Zonix/deploy/demo.env) and [deploy/.env.example](C:/Users/Ya/OneDrive/Desktop/Zonix/deploy/.env.example).

## Database Upgrade

- apply the latest migrations before serving traffic
- `0004_performance_indexes.sql` adds indexes for audit and zone read paths
- if you previously ran on a schema before the hardening and performance milestones, let the backend container start once and verify the migration log is clean

## Compose Upgrade Path

1. Pull the updated repository snapshot.
2. Review `deploy/demo.env` and align any local port overrides or backend toggles.
3. Rebuild and restart the stack:

```bash
npm run compose:up
```

4. Run the smoke verifier:

```bash
npm run compose:verify
```

5. Confirm:

- `GET /health`
- `GET /ready`
- `GET /metrics`
- local admin login
- protected zone listing

## Frontend Upgrade Notes

- the shell now avoids blind session lookups when no readable CSRF cookie is present
- mocked or reverse-proxied test environments must emulate the readable `zonix_csrf_token` cookie on successful login flows if they expect reload or OIDC callback hydration to work

## Operational Checks After Upgrade

- verify trusted hosts match the actual hostnames used by your staging or beta environment
- verify session cookies behave correctly behind your reverse proxy or ingress
- verify PowerDNS and optional BIND connectivity from the running backend container, not just from the host
- verify audit events still appear for login and record mutations

## Rollback

There is no special rollback tooling in this RC. If you need to revert:

1. stop the upgraded stack
2. restore the previous repository snapshot and environment
3. restore the database backup if the schema or data must be returned to the older state
