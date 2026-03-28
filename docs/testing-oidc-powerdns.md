# Testing OIDC and PowerDNS Locally

This guide covers the current local Day 20 stack:

- frontend on `http://localhost:5173`
- backend API on `http://localhost:8000`
- Keycloak-backed OIDC gateway on `http://localhost:9010`
- PowerDNS API on `http://localhost:8081`

## 1. Start the local stack

From the repository root:

```bash
cd /mnt/c/Users/Ya/OneDrive/Desktop/Zonix/deploy
docker compose up -d
```

## 2. Run quick health checks

Confirm that the core services are up:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/auth/settings
curl http://localhost:9010/realms/zonix/.well-known/openid-configuration
```

Expected signals:

- backend health returns `status: ok`
- auth settings show `localLoginEnabled: true`
- auth settings show `oidcEnabled: true`
- OIDC discovery returns a valid JSON document

## 3. Test OIDC login in the browser

Open:

- `http://localhost:5173`

Use the `Sign in with corp-oidc` button.

The local demo realm provides these browser credentials:

- `oidc.admin / admin`
- `oidc.editor / editor`
- `oidc.viewer / viewer`

### Admin expectations

Login as `oidc.admin`.

Verify:

- the top bar shows role `admin`
- both zones are available
- all main tabs are accessible: `Records`, `Operations`, `Access`, `Auth`
- admin-only actions are visible, including backend sync and access management

### Editor expectations

Login as `oidc.editor`.

Verify:

- the top bar shows role `editor`
- only `example.com` is available
- record write actions are enabled
- backend sync stays admin-only

### Viewer expectations

Login as `oidc.viewer`.

Verify:

- the top bar shows role `viewer`
- only `internal.example` is available
- `Add record` is disabled
- row-level `Edit`, `Duplicate`, and `Delete` actions are disabled
- `Access` renders an admin-only state
- `Auth` renders a read-only posture view

## 4. Test real PowerDNS write flow through the UI

The easiest path is to log in as `oidc.editor`.

### Create a temporary record

In `Records`:

1. Click `Add record`
2. Use a temporary RRset such as:
   - `Type`: `TXT`
   - `Name`: `oidc-test`
   - `TTL`: `300`
   - `Value`: `"hello"`
3. Save the record

Verify that the record appears in the table.

### Confirm it in PowerDNS directly

PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing `
  http://localhost:8081/api/v1/servers/localhost/zones/example.com. `
  -Headers @{ 'X-API-Key' = 'zonix-dev-powerdns-key' } |
  Select-Object -ExpandProperty Content
```

Check the returned zone JSON for:

- `oidc-test.example.com.`
- record type `TXT`

### Delete the temporary record

Delete the same record from the UI and run the same PowerDNS API request again.

Expected result:

- the RRset no longer exists in the PowerDNS zone payload

## 5. Test local admin login

The local non-OIDC bootstrap account should still work:

- `admin / local-dev-admin-change-me`

Quick API check:

```bash
curl -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"local-dev-admin-change-me"}'
```

## 6. Run automated tests

### Backend auth and OIDC tests

```bash
python -m unittest \
  backend.tests.test_oidc \
  backend.tests.test_auth_api \
  backend.tests.test_bootstrap \
  backend.tests.test_oidc_gateway
```

### Live PowerDNS integration tests

```bash
python -m unittest backend.tests.test_powerdns_flow_integration
python -m pytest backend/tests/test_powerdns_live_integration.py
```

### Frontend checks

```bash
npm --prefix frontend run lint
npm --prefix frontend run test
npm --prefix frontend run build
```

## 7. What is considered a passing local result

The local environment is in a good state when all of the following are true:

- OIDC discovery works on `localhost:9010`
- `oidc.admin`, `oidc.editor`, and `oidc.viewer` can all sign in
- role mapping is correct in the UI
- zone visibility matches the mapped grants
- `oidc.editor` can create and delete a record through the UI
- PowerDNS confirms the RRset creation and deletion directly via its API
- local admin login still works
- backend and frontend automated checks are green
