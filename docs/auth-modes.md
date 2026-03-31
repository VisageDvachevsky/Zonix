# Auth Modes

## Supported modes in v0.1

- local username/password login
- generic OIDC browser login

Both modes end in the same backend-issued session model. The frontend never stores bearer tokens directly for normal browser operation.

## Local login

Request:

- `POST /auth/login`
- body: `{"username":"admin","password":"local-dev-admin-change-me"}`

Behavior:

- backend verifies the password hash from the user store
- session cookie is issued
- CSRF cookie is issued alongside the session
- audit trail records success or failure

Demo local users:

- `admin / local-dev-admin-change-me`
- `alice / editor`
- `bob / viewer`

## OIDC login

Request flow:

1. frontend calls `GET /auth/oidc/{provider_name}/login`
2. backend returns an authorization URL with signed state
3. browser completes provider login
4. provider redirects to backend callback
5. backend exchanges the code, loads user info, maps claims/groups, and redirects back into the frontend

Demo OIDC identities in the compose stack:

- `oidc.admin / admin`
- `oidc.editor / editor`
- `oidc.viewer / viewer`

## Session model

- session cookie name and flags are backend-configurable
- cookie auth is the default browser path
- the frontend calls `/auth/me` to resolve the active session
- logout happens through `POST /auth/logout`

## CSRF

State-changing browser and `curl` requests must send:

- `zonix_session` cookie
- `zonix_csrf_token` cookie
- `X-CSRF-Token` header mirroring the CSRF cookie value

This applies to:

- logout
- record create/update/delete
- admin writes

## Authorization model

Global role:

- `admin`: full product access
- `editor`: no admin surface, write only where a zone grant permits it
- `viewer`: read-only where a zone grant permits it

Zone grants:

- define access per zone
- can allow `read`
- can allow `write`
- are enforced in both backend policy and frontend affordances

## OIDC claims mapping

The backend can map provider claims into:

- username
- global role
- zone-specific grants

The default demo config uses:

- `preferred_username` as the username claim
- `groups` as the roles source
- fixed admin groups
- templated group patterns for zone editors/viewers

## Hardening defaults

- self-signup is disabled by default
- session cookie security attributes are explicit
- login and logout are audited
- bootstrap admin password must be overridden outside development
