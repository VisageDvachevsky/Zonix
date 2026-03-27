# Zonix PRD v0.1

## Product goal

Deliver a working DNS control plane for a small team that already runs PowerDNS or BIND-compatible DNS and needs a shared UI and API with audit trail and RBAC.

## Problem statement

Teams that operate DNS across PowerDNS or BIND-compatible systems usually combine direct backend access, ad hoc scripts, and tribal knowledge. That creates inconsistent change flows, weak auditability, and unclear ownership over who can touch which zones.

Zonix v0.1 solves that by introducing one control plane with a clear API, a usable UI, explicit permissions, and a backend-agnostic domain model.

## Fixed implementation stack

- frontend: React, TypeScript, TanStack Query, Zod
- backend: FastAPI, Pydantic

The stack is fixed for v0.1 and all further scaffolding, tests, and delivery artifacts should align with it.

## Target users

- infrastructure or platform engineers
- ops or admin users responsible for DNS
- small teams replacing manual DNS changes across multiple backends

## User outcomes

- reduce direct manual writes to DNS backends
- centralize read and write access behind one audited surface
- make zone-scoped access control understandable and enforceable
- support both UI-driven changes and automation-friendly API usage

## Core use cases

- sign in with local credentials or a generic OIDC provider
- view the backends and zones available to the current identity
- inspect zone records
- create, update, and delete records when authorized
- see who changed what and when
- restrict access by global role and zone-level grants

## Non-functional expectations for v0.1

- all supported flows are exposed through FastAPI and described via OpenAPI
- frontend is built in React and consumes the published API rather than hidden contracts
- auditability is a first-class behavior, not a later add-on
- backend adapters expose explicit capabilities instead of pretending feature parity
- the local developer environment starts from documented commands

## In scope for v0.1

- local auth and generic OIDC
- roles: `admin`, `editor`, `viewer`
- zone-level permission grants
- PowerDNS adapter with read and write flows for core record types
- RFC2136/BIND-compatible adapter with explicit capability flags and honest limitations
- unified core model across auth, audit, backends, zones, and records
- audit trail for logins and record changes
- OpenAPI for supported flows
- UI for auth, zone browsing, record CRUD, audit, and basic admin flows
- local Docker Compose demo and quickstart docs

## Scope freeze

The Day 1 scope is frozen around the v0.1 release gates and the in-scope list above. Any new idea outside these boundaries is deferred to v0.2+ unless it directly unblocks a listed release gate.

## Explicitly out of scope for v0.1

- SaaS multi-tenancy
- full vendor-specific metadata parity
- unrestricted real-time bidirectional sync
- complete edge-case coverage for every backend
- enterprise polish beyond the working product

## Release gates

- local and OIDC login work end-to-end
- zone-scoped grants can be assigned and enforced
- PowerDNS zone browsing and record editing work from UI
- at least one honest RFC2136/BIND-compatible read and write flow works
- audit events capture login and record mutations with actor, backend, and zone
- frontend uses the supported API rather than private contracts
- demo environment starts from quickstart without manual intervention
