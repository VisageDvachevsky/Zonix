# Zonix v0.1.0-rc2 Release Notes

## Scope

This release candidate advances the closed-beta build with UI polish, audit visibility improvements, and explicit operator documentation for testing against real DNS infrastructure.

## Highlights

- tutorial overlay no longer blurs the workspace background
- decorative tutorial orbit and aura effects were removed to keep coachmarks readable
- zone detail record table readability was corrected for the light theme
- audit cards now surface auth source explicitly, including `OIDC · corp-oidc`
- local login audit events now carry `authSource=local` for parity with OIDC session events
- added a dedicated real-environment runbook in `docs/real-dns-deployment.md`

## Intended use

This RC is suitable for:

- continued closed-beta validation
- staging deployment against non-production authoritative DNS
- PowerDNS API validation
- RFC2136/BIND validation with a delegated test zone

## Verification

- `npm --prefix frontend run test`
- `npm --prefix frontend run build`
- `python -m unittest backend.tests.test_auth_api`
- live Playwright verification for light-theme zone detail readability and OIDC audit visibility on the Compose stack
