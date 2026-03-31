# Closed Beta Runbook for v0.1.0-rc1

This runbook covers the first closed-beta rollout for `v0.1.0-rc1`.
It assumes the operator is starting from this repository and the bundled Compose assets.

## 1. Prepare the environment

1. Check out tag `v0.1.0-rc1`.
2. Copy `deploy/demo.env` into environment-specific secret management or an equivalent env file.
3. Replace development-only secrets before exposing the stack beyond a local workstation.
4. Decide which hostnames will front the backend and add them to `ZONIX_ALLOWED_HOSTS`.
5. Make sure `ZONIX_ALLOWED_WEB_ORIGINS` includes the real published frontend origin if you are not using the default `5173` port.

## 2. Start the stack

1. Run `npm run compose:up`.
2. If you need custom published ports, export `ZONIX_HOST_*_PORT` overrides before the command.
3. Wait until `docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml ps` shows healthy backend, frontend, OIDC gateway, and Postgres services.

## 3. Verify the running ports

Use the running Compose project as the source of truth:

```bash
docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port backend 8000
docker compose --env-file deploy/demo.env -f deploy/docker-compose.yml port frontend 5173
```

Use those published addresses for any browser or API smoke checks if they differ from the defaults in `deploy/demo.env`.

## 4. Run the automated smoke gate

Run:

```bash
npm run compose:verify
```

What it validates:

- `/health`
- `/ready`
- `/metrics`
- bootstrap admin login
- authenticated `/auth/me`
- protected `/zones`

If it fails:

- inspect `docker compose ... ps`
- inspect `docker logs deploy-backend-1 --tail 200`
- verify the backend published port with `docker compose ... port backend 8000`
- rerun after the broken service is healthy

## 5. Run the manual browser gate

Open the published frontend URL and complete this path with the bootstrap admin:

1. Sign in.
2. Open a clean browser session and sign in through `corp-oidc`.
3. Confirm the browser returns to the published frontend URL in an authenticated workspace.
4. Open the zones inventory.
5. Open `example.com`.
6. Click `Add record`.
7. Create a temporary record.
8. Use `Preview changes`.
9. Apply the change.
10. Open `Audit` and confirm the create event is visible.
11. Remove the temporary record or leave it only if the beta plan explicitly allows seeded test artifacts.

The March 31, 2026 RC verification used this path successfully against the live Compose stack and confirmed:

- local login through the real frontend shell
- clean-browser OIDC login through Keycloak and redirect back to the published frontend
- record creation through the real UI
- audit visibility for the performed mutation

## 6. Confirm security posture

Check these behaviors before inviting beta users:

- unexpected `Host` is rejected
- large login bodies fail with `413`
- repeated bad logins fail with `429`
- security headers are present on API responses

If the environment is internet-reachable, also confirm:

- HTTPS termination is active
- cookie security flags match the deployment transport
- development-only credentials were replaced

## 7. Observe the rollout

Watch:

- `docker logs deploy-backend-1 --tail 200 -f`
- `GET /metrics`
- `GET /ready`

Look for:

- repeated request failures
- readiness degradation
- inventory sync errors
- unexpected login throttling

## 8. Roll back if required

Use rollback when:

- `compose:verify` cannot be restored quickly
- the browser gate fails on the main operator path
- security checks fail in the target environment

Rollback steps:

1. Stop user access at the ingress or frontend layer.
2. Redeploy the previous known-good image or Git tag.
3. Run `compose:verify` again against the reverted stack.
4. Re-run the browser gate before re-opening beta access.

## 9. Exit criteria for the closed beta

The RC is acceptable for a limited beta only if all of the following are true:

- automated smoke gate passes
- browser gate passes on the real published frontend
- OIDC gate passes from a clean browser session on the real published frontend
- create/delete audit loop is confirmed
- security checks pass for the target hostnames
- operators know the rollback command path

## 10. Acceptance matrix captured on March 31, 2026

- `admin`: saw `example.com` and `internal.example`, could reach `/admin/users`, and could preview/create/delete records in `example.com`
- `alice` (`editor`): saw only `example.com`, could preview/create/delete there, and received `403` on `/admin/users`
- `bob` (`viewer`): saw only `internal.example`, received `404` on `example.com`, and received `403` on `/admin/users`

Treat this matrix as the minimum role-behavior baseline for any future beta deployment of the same RC.
