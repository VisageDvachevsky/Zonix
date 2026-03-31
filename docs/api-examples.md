# API Examples

All examples below assume the demo stack from [`quickstart.md`](./quickstart.md) is already running.

## Login

```bash
curl -c zonix-cookie.txt -i -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"local-dev-admin-change-me"}'
```

## Resolve the active session

```bash
curl -b zonix-cookie.txt -i http://localhost:8000/auth/me
```

## List visible backends and zones

```bash
curl -b zonix-cookie.txt -i http://localhost:8000/backends
curl -b zonix-cookie.txt -i http://localhost:8000/zones
```

## Read a zone and its records

```bash
curl -b zonix-cookie.txt -i http://localhost:8000/zones/example.com
curl -b zonix-cookie.txt -i http://localhost:8000/zones/example.com/records
```

## Extract the CSRF token for write requests

```bash
python - <<'PY'
from http.cookiejar import MozillaCookieJar

jar = MozillaCookieJar("zonix-cookie.txt")
jar.load(ignore_discard=True, ignore_expires=True)
for cookie in jar:
    if cookie.name == "zonix_csrf_token":
        print(cookie.value)
        break
PY
```

## Preview a change before apply

```bash
curl -b zonix-cookie.txt -i -X POST http://localhost:8000/zones/example.com/changes/preview \
  -H "Content-Type: application/json" \
  -d '{"operation":"create","zoneName":"example.com","name":"preview-api","recordType":"A","ttl":300,"values":["192.0.2.44"]}'
```

## Create a record

```bash
curl -b zonix-cookie.txt -i -X POST http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"api-created","recordType":"TXT","ttl":300,"values":["\"created-from-api\""]}'
```

## Update a record with optimistic locking

First, inspect the current record to get its `version`, then submit:

```bash
curl -b zonix-cookie.txt -i -X PUT http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"www","recordType":"A","ttl":600,"values":["192.0.2.99"],"expectedVersion":"<paste-version>"}'
```

## Delete a record

```bash
curl -b zonix-cookie.txt -i -X DELETE http://localhost:8000/zones/example.com/records \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <paste-csrf-cookie>" \
  -d '{"zoneName":"example.com","name":"api-created","recordType":"TXT","expectedVersion":"<paste-version>"}'
```

Successful deletes return `204 No Content`.

## Read audit events

```bash
curl -b zonix-cookie.txt -i http://localhost:8000/audit
```

## Health and metrics

```bash
curl -i http://localhost:8000/health
curl -i http://localhost:8000/ready
curl -i http://localhost:8000/metrics
```

## OIDC login start

```bash
curl -i "http://localhost:8000/auth/oidc/corp-oidc/login?return_to=http://localhost:5173/"
```

The backend responds with an authorization URL. The browser callback flow should still be used for the full session exchange.
