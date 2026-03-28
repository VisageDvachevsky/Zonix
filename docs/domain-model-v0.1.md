# Zonix Domain Model v0.1

## Purpose

The domain model defines the control plane vocabulary independently of any particular DNS backend. PowerDNS and RFC2136/BIND-compatible adapters must map into this model instead of leaking backend-specific structures into the service layer.

## Entities

### User

- represents a human operator or service identity known to Zonix
- owns a global role and can receive additional zone-level grants
- identified by a stable username or subject identifier

Core fields:
- `username`
- `role`

### Role

- coarse-grained global authorization baseline
- fixed to `admin`, `editor`, `viewer` for v0.1

Authorization intent:
- `admin`: can manage configuration and all zones
- `editor`: can modify zones where access is granted
- `viewer`: can only read zones where access is granted

### PermissionGrant

- explicit zone-level authorization entry
- links a user to one zone and a set of allowed actions

Core fields:
- `username`
- `zone_name`
- `actions`

### IdentityProvider

- configuration entity for local auth or external generic OIDC
- abstracts the source of identity away from policy evaluation

Core fields:
- `name`
- `kind`
- `issuer`
- `client_id`
- `client_secret`
- `scopes`
- `claims_mapping_rules`

### Backend

- registered DNS backend known to the control plane
- source of zones and record mutations
- advertises capabilities rather than implying full parity

Core fields:
- `name`
- `backend_type`
- `capabilities`

### Zone

- DNS zone attached to one backend
- authorization is evaluated at this boundary in v0.1

Core fields:
- `name`
- `backend_name`

### RecordSet

- normalized representation of one DNS RRset in a zone
- used by both backend adapters and UI/API contracts

Core fields:
- `zone_name`
- `name`
- `record_type`
- `ttl`
- `values`

### ChangeSet

- one logical change proposal or applied mutation batch
- groups record mutations under one actor and one zone context

Core fields:
- `actor`
- `zone_name`
- `summary`

### AuditEvent

- immutable audit log record
- emitted for authentication and record-change actions

Core fields:
- `actor`
- `action`
- `zone_name`
- `backend_name`

## Shared enums and contracts

### Roles

- `admin`
- `editor`
- `viewer`

### Zone actions

- `read`
- `write`
- `grant`

### Backend capabilities

- `readZones`
- `readRecords`
- `writeRecords`
- `discoverZones`
- `importSnapshot`
- `commentsMetadata`
- `axfr`
- `rfc2136Update`

## Invariants

- every `Zone` belongs to exactly one `Backend`
- every `PermissionGrant` targets exactly one zone
- every `AuditEvent` must have an actor and an action
- every `RecordSet` belongs to exactly one zone
- the service layer must use these entities even when a backend has richer native metadata

## v0.1 modeling constraints

- the model is intentionally backend-agnostic
- vendor-specific metadata is not part of the core model in v0.1
- roles are fixed and not user-defined in v0.1
- zone-level grants are the finest-grained authorization unit in v0.1
