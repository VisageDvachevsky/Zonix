# Backend Adapters

## Adapter contract

Zonix exposes different DNS backends through one control-plane model:

- inventory of named backends
- visible zones
- normalized RRsets
- capability flags that describe what each backend can actually do

The contract is intentionally honest. If an adapter cannot support a workflow, the limitation is surfaced in docs, API, and UI.

## PowerDNS adapter

Status:

- primary v0.1 adapter
- full read/write path for the main record workflows

Supported story:

- backend registration
- zone listing
- zone detail
- record create/update/delete
- audit logging for each applied mutation

Configuration:

- `ZONIX_POWERDNS_BACKEND_ENABLED`
- `ZONIX_POWERDNS_BACKEND_NAME`
- `ZONIX_POWERDNS_API_URL`
- `ZONIX_POWERDNS_API_KEY`
- `ZONIX_POWERDNS_SERVER_ID`
- `ZONIX_POWERDNS_TIMEOUT_SECONDS`

Operational notes:

- the backend entrypoint waits for the PowerDNS API before boot
- the wait probe sends the configured API key
- compose quickstart seeds deterministic demo zones

## RFC2136/BIND-compatible adapter

Status:

- minimal but real v0.1 adapter
- designed for teams that already own a BIND-style authoritative path

Supported story:

- manual backend registration
- explicit zone inventory
- read path through AXFR
- fallback read path through declared snapshots
- write path through RFC2136 update messages

Configuration:

- `ZONIX_BIND_BACKEND_ENABLED`
- `ZONIX_BIND_BACKEND_NAME`
- `ZONIX_BIND_SERVER_HOST`
- `ZONIX_BIND_SERVER_PORT`
- `ZONIX_BIND_TIMEOUT_SECONDS`
- `ZONIX_BIND_AXFR_ENABLED`
- `ZONIX_BIND_TSIG_KEY_NAME`
- `ZONIX_BIND_TSIG_SECRET`
- `ZONIX_BIND_TSIG_ALGORITHM`
- `ZONIX_BIND_ZONE_NAMES`
- `ZONIX_BIND_SNAPSHOT_FILE_MAP`

Operational notes:

- the default compose stack keeps this adapter disabled
- `deploy/docker-compose.bind-lab.yml` enables a reproducible BIND lab
- the BIND lab adds demo grants so role-based zone access can be tested end-to-end

## Capability flags

The UI relies on capability flags to avoid promising unsupported behavior.

Examples:

- discovery
- zone metadata
- record reads
- record writes

Practical effect:

- unsupported actions are hidden or disabled
- read-only sessions stay usable without exposing fake mutation controls

## Choosing an adapter

Use PowerDNS when:

- you need the smoothest v0.1 path
- you want the strongest CRUD coverage today

Use RFC2136/BIND-compatible when:

- you already operate BIND or another RFC2136-compatible system
- you can live with manual inventory and explicit limitations

## Expected operator workflow

1. register or bootstrap the backend
2. verify visible zones in the UI/API
3. open a zone and inspect records
4. preview the change
5. apply the change
6. confirm the audit trail
