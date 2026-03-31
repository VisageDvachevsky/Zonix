# Zonix v0.1.0-rc1 Known Limitations

## Product Scope

- deeper PowerDNS feature coverage beyond the current MVP record-management path is still out of scope
- Kubernetes support exists only as a minimal Helm story, not as a production-hardened deployment package
- startup sync and backend import remain explicit and minimal rather than fully automated lifecycle management

## Identity and User Management

- OIDC self-signup is disabled by default
- richer user lifecycle flows are still incomplete: this RC focuses on role and grant administration, not full provisioning workflows
- service accounts and token flows are still narrower than a full enterprise IAM story

## Backend and DNS Operations

- RFC2136/BIND support depends on explicit configuration and does not yet provide the same depth of operator ergonomics as the primary PowerDNS path
- snapshot and AXFR fallback behaviors are present, but large-scale operational edge cases still need broader real-world validation
- this RC assumes small-team operational patterns, not high-churn multi-tenant DNS automation

## Audit and Observability

- audit is optimized for the MVP operational feed, not for long-term retention or external SIEM pipelines
- metrics and structured logs are intentionally basic and may need expansion before broader production rollout

## Upgrade and Release Process

- this is still a release candidate, not a final stable release
- there is no automated rollback or migration orchestration beyond the existing container/bootstrap flow
- release workflows are still repo-driven rather than fully automated through an external release pipeline

## Beta Guidance

Use this RC for a closed beta with real operators and real zones, but keep the rollout narrow enough that manual recovery is acceptable if you hit an uncovered edge case.
