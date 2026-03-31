# Zonix v0.1.0-rc1 Release Notes

## Scope

This release candidate packages the first complete MVP slice of Zonix: a DNS control plane UI and API over PowerDNS and RFC2136/BIND-compatible backends with local auth, OIDC login, zone-level grants, record previews, and operational hardening.

## Highlights

- authenticated operator shell with route-aware navigation for zones, zone detail, backend inventory, audit, and admin workspaces
- local username/password sign-in plus generic OIDC login start/callback flow with claims-to-role and claims-to-zone-grant mapping
- backend registry with PowerDNS and RFC2136/BIND adapter support
- managed zone inventory with explicit sync and import flows
- record create, update, delete, preview, conflict detection, and optimistic version checks
- audit events for login, logout, and record mutations with actor, zone, backend, and payload context
- operational endpoints for `health`, `ready`, and `metrics`
- structured request logging, trusted host checks, security headers, request body limits, and login rate limiting
- Docker Compose demo stack with deterministic bootstrap users and optional BIND lab
- minimal Helm chart for the frontend/backend deployment story

## Included Verification

- backend automated suite covering auth, access, audit, adapters, and API behavior
- frontend unit coverage for shell, admin workflows, record editing, and auth state
- Playwright coverage for local login, OIDC login, zone navigation, record edits, audit visibility, and tutorial flows
- live compose validation for demo login, zone navigation, audit access, readiness, metrics, and security/runtime behavior

## Intended Audience

This RC is suitable for a closed beta with small infrastructure teams who can tolerate explicit operational steps and known product gaps while validating the control-plane workflow on real zones.

## Notable Changes Since Earlier Milestones

- the demo stack is now reproducible through `deploy/demo.env` and `npm run compose:verify`
- auth defaults are stricter and safer by default
- non-admin read paths no longer depend on broad in-memory scans of zone and audit data
- release-facing documentation now covers quickstart, architecture, auth modes, backend adapters, API examples, upgrade notes, and known limitations
