# Zonix Helm chart

This chart is the minimal Kubernetes story for day 43.

What it deploys:

- `frontend` Deployment and Service
- `backend` Deployment and Service
- ConfigMap + Secret wiring for the backend runtime
- optional Ingress for the frontend

What it does not pretend to solve yet:

- in-cluster PowerDNS, MariaDB, Postgres, Keycloak, or OIDC gateway packaging
- multi-replica backend coordination for migrations/bootstrap
- production-grade secret management

Operational constraints:

- keep `backend.replicaCount=1` unless you move migrations/bootstrap into a dedicated Job
- point `backend.secretEnv.databaseUrl`, `backend.env.powerdnsApiUrl`, and OIDC settings at already running services
- use real image repositories instead of the placeholder `zonix/*` defaults

Example install:

```bash
helm upgrade --install zonix ./deploy/helm/zonix \
  --set frontend.image.repository=ghcr.io/acme/zonix-frontend \
  --set backend.image.repository=ghcr.io/acme/zonix-backend \
  --set backend.secretEnv.databaseUrl=postgresql://zonix:secret@postgresql.platform.svc.cluster.local:5432/zonix \
  --set backend.secretEnv.sessionSecretKey="$(openssl rand -hex 32)" \
  --set backend.secretEnv.bootstrapAdminPassword=change-me \
  --set backend.secretEnv.oidcBootstrapClientSecret=change-me \
  --set backend.secretEnv.powerdnsApiKey=change-me
```
