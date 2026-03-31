# Closed Beta Checklist for v0.1.0-rc1

This checklist is for promoting the `v0.1.0-rc1` tag into a controlled closed-beta environment.
Every item below is grounded in the local Compose stack and smoke paths verified on March 31, 2026.

## Release identity

- Confirm `git rev-parse --short v0.1.0-rc1` matches the intended RC commit.
- Confirm the worktree is clean before building or publishing new images.
- Keep these docs bundled with the exact RC tag:
  - `docs/release-notes-v0.1.0-rc1.md`
  - `docs/upgrade-notes-v0.1.0-rc1.md`
  - `docs/known-limitations-v0.1.0-rc1.md`
  - `docs/closed-beta-runbook-v0.1.0-rc1.md`

## Preflight

- Docker/Compose available on the operator host.
- Postgres, PowerDNS, Keycloak, OIDC gateway, backend, and frontend containers all start healthy.
- Secrets replaced for any environment outside a single developer workstation:
  - `ZONIX_BOOTSTRAP_ADMIN_PASSWORD`
  - `ZONIX_SESSION_SECRET_KEY`
  - `ZONIX_OIDC_BOOTSTRAP_CLIENT_SECRET`
  - PowerDNS API credentials
- Hostnames added to `ZONIX_ALLOWED_HOSTS` for the real ingress path.
- TLS termination plan defined if the beta is exposed outside localhost.

## Startup checks

- `docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml ps`
- `docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port backend 8000`
- `docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port frontend 5173`
- `npm run compose:verify`

Expected result:

- backend `/health` returns `200`
- backend `/ready` returns `200`
- backend `/metrics` exposes `zonix_http_requests_total`
- bootstrap admin login succeeds
- protected `/zones` listing succeeds

## API acceptance

- `GET /health`
- `GET /ready`
- `GET /metrics`
- `POST /auth/login`
- `GET /auth/me`
- `GET /backends`
- `GET /zones`
- `GET /zones/example.com`
- `GET /zones/example.com/records`
- `POST /zones/example.com/changes/preview`
- `POST /zones/example.com/records`
- `DELETE /zones/example.com/records`
- `GET /audit`

Expected result:

- CSRF cookie is issued on login.
- Record preview works before apply.
- Record create and delete both emit audit events.
- The protected list and detail routes return data under the authenticated session.

## UI acceptance

- Sign in through the frontend shell.
- Sign in through OIDC from a clean browser session.
- Open the zones inventory.
- Open `example.com`.
- Create a record through the editor drawer.
- Review the diff preview.
- Apply the change.
- Confirm the new record appears in the table.
- Open the audit page and confirm the create event is visible.

Expected result:

- The main operator path works without page-level errors.
- OIDC login returns to the published frontend URL and lands in an authenticated workspace.
- The zone detail surface remains usable after mutation.
- Audit visibility reflects the performed mutation.

## Role matrix acceptance

- `admin` sees `example.com` and `internal.example`.
- `admin` can reach `/admin/users`.
- `admin` can preview, create, and delete records in `example.com`.
- `alice` sees only `example.com`.
- `alice` can preview, create, and delete records in `example.com`.
- `alice` gets `403` on `/admin/users`.
- `bob` sees only `internal.example`.
- `bob` gets `404` on `example.com`.
- `bob` gets `403` on `/admin/users`.

Expected result:

- Zone visibility matches grants for each role.
- Write access is available only where the role is expected to mutate records.
- Admin-only routes stay blocked for non-admin users.

## Security acceptance

- Invalid `Host` header is rejected.
- Oversized login payload is rejected with `413`.
- Repeated failed logins are throttled with `429`.
- Responses include the hardening headers added in Day 46.

## Observability acceptance

- `/metrics` is reachable from the operator network.
- Request counters increase during smoke traffic.
- Structured backend request logs are visible in container logs.
- `/ready` reports database and inventory-sync state.

## Rollback readiness

- Previous image/tag or commit is identified before rollout.
- Rollback command path is written down before first beta user access.
- Beta data retention expectations are documented if test users mutate real zones.

## Known gate decisions

- `compose:verify` is the minimum acceptance gate for a running stack.
- Manual browser verification, including OIDC from a clean browser session, is still required before allowing external beta users.
- Closed beta should remain limited to trusted operators until HTTPS, secret rotation, and ingress hostnames are configured for the target environment.
