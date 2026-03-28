import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import frontendPackage from "../frontend/package.json" with { type: "json" };

const repoRoot = process.cwd();
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("monorepo directories required for day 4 exist", () => {
  const requiredPaths = ["backend", "frontend", "docs", "deploy", "tests"];

  for (const relativePath of requiredPaths) {
    assert.equal(
      existsSync(join(repoRoot, relativePath)),
      true,
      `expected ${relativePath} to exist`,
    );
  }
});

test("repository contains frozen PRD for v0.1 scope", () => {
  assert.equal(existsSync(join(repoRoot, "docs", "prd-v0.1.md")), true);
});

test("repository contains a dedicated domain model document for day 2", () => {
  assert.equal(existsSync(join(repoRoot, "docs", "domain-model-v0.1.md")), true);
});

test("repository contains a backend capability matrix for day 3", () => {
  assert.equal(
    existsSync(join(repoRoot, "docs", "backend-capability-matrix-v0.1.md")),
    true,
  );
});

test("fixed stack is documented in the delivery plan", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  assert.match(readme, /React \+ TypeScript \+ TanStack Query \+ Zod/);
  assert.match(readme, /FastAPI \+ Pydantic/);
});

test("backend project is configured around FastAPI and Pydantic", () => {
  const pyproject = readFileSync(join(repoRoot, "backend", "pyproject.toml"), "utf8");
  assert.match(pyproject, /fastapi/);
  assert.match(pyproject, /pydantic/);
});

test("frontend workspace is configured around React, TypeScript, TanStack Query, and Zod", () => {
  assert.equal(frontendPackage.dependencies.react !== undefined, true);
  assert.equal(frontendPackage.dependencies["@tanstack/react-query"] !== undefined, true);
  assert.equal(frontendPackage.dependencies.zod !== undefined, true);
  assert.equal(frontendPackage.devDependencies.typescript !== undefined, true);
});

test("python backend entrypoint exists", () => {
  assert.equal(existsSync(join(repoRoot, "backend", "app", "main.py")), true);
});

test("day 4 engineering guardrails exist", () => {
  for (const relativePath of [
    ".github/workflows/ci.yml",
    ".pre-commit-config.yaml",
    "frontend/eslint.config.js",
    ".prettierrc.json",
  ]) {
    assert.equal(existsSync(join(repoRoot, relativePath)), true, `expected ${relativePath} to exist`);
  }
});

test("day 5 local development stack exists", () => {
  for (const relativePath of [
    "deploy/docker-compose.yml",
    "docs/quickstart.md",
    "backend/migrations/0001_initial.sql",
    "backend/app/bootstrap.py",
  ]) {
    assert.equal(existsSync(join(repoRoot, relativePath)), true, `expected ${relativePath} to exist`);
  }
});

test("prd freezes day 1 scope around users, use cases, scope, and exclusions", () => {
  const prd = readFileSync(join(repoRoot, "docs", "prd-v0.1.md"), "utf8");
  assert.match(prd, /## Target users/);
  assert.match(prd, /## Core use cases/);
  assert.match(prd, /## In scope for v0\.1/);
  assert.match(prd, /## Explicitly out of scope for v0\.1/);
  assert.match(prd, /## Scope freeze/);
});

test("domain model document enumerates all required core entities", () => {
  const domainModel = readFileSync(join(repoRoot, "docs", "domain-model-v0.1.md"), "utf8");
  for (const entity of [
    "User",
    "Role",
    "PermissionGrant",
    "IdentityProvider",
    "Backend",
    "Zone",
    "RecordSet",
    "ChangeSet",
    "AuditEvent",
  ]) {
    assert.match(domainModel, new RegExp(`### ${entity}`));
  }
});

test("backend capability matrix documents the v0.1 adapter contract", () => {
  const capabilityMatrix = readFileSync(
    join(repoRoot, "docs", "backend-capability-matrix-v0.1.md"),
    "utf8",
  );
  for (const capability of [
    "readZones",
    "readRecords",
    "writeRecords",
    "discoverZones",
    "importSnapshot",
    "commentsMetadata",
    "axfr",
    "rfc2136Update",
  ]) {
    assert.match(capabilityMatrix, new RegExp(capability));
  }
  assert.match(capabilityMatrix, /powerdns/);
  assert.match(capabilityMatrix, /rfc2136-bind/);
});

test("root scripts expose lint, format, migrate, bootstrap, and compose workflows", () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  for (const scriptName of [
    "lint",
    "format",
    "format:check",
    "migrate",
    "bootstrap:admin",
    "compose:up",
  ]) {
    assert.equal(packageJson.scripts[scriptName] !== undefined, true, `missing script ${scriptName}`);
  }
});

test("local backend defaults point at docker postgres on 55432 and a stable dev command", () => {
  const configSource = readFileSync(join(repoRoot, "backend", "app", "config.py"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const quickstart = readFileSync(join(repoRoot, "docs", "quickstart.md"), "utf8");

  assert.match(configSource, /127\.0\.0\.1:55432/);
  assert.match(packageJson.scripts["dev:backend"], /python -m uvicorn app\.main:app --host 127\.0\.0\.1 --port 8010/);
  assert.doesNotMatch(packageJson.scripts["dev:backend"], /--reload/);
  assert.match(quickstart, /localhost:55432/);
  assert.match(quickstart, /127\.0\.0\.1:8010/);
});

test("frontend shell is wired through TanStack Query and zod contracts", () => {
  const appSource = readFileSync(join(repoRoot, "frontend", "src", "App.tsx"), "utf8");
  const apiSource = readFileSync(join(repoRoot, "frontend", "src", "api.ts"), "utf8");
  assert.match(appSource, /useQuery/);
  assert.match(apiSource, /z\.object/);
});

test("compose stack includes postgres, backend, and frontend services", () => {
  const compose = readFileSync(join(repoRoot, "deploy", "docker-compose.yml"), "utf8");
  assert.match(compose, /postgres:/);
  assert.match(compose, /backend:/);
  assert.match(compose, /frontend:/);
});

test("day 6 auth skeleton includes login logout session auth and bootstrap admin wiring", () => {
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const bootstrapSource = readFileSync(join(repoRoot, "backend", "app", "bootstrap.py"), "utf8");
  const quickstart = readFileSync(join(repoRoot, "docs", "quickstart.md"), "utf8");

  assert.match(mainSource, /@app\.post\(\"\/auth\/login\"/);
  assert.match(mainSource, /@app\.post\(\"\/auth\/logout\"/);
  assert.match(mainSource, /@app\.get\(\"\/auth\/me\"/);
  assert.match(mainSource, /set_cookie/);
  assert.match(bootstrapSource, /INSERT INTO users/);
  assert.match(quickstart, /POST http:\/\/localhost:8000\/auth\/login/);
});

test("day 7 policy evaluator exists for admin editor viewer role enforcement", () => {
  const policySource = readFileSync(join(repoRoot, "backend", "app", "policy.py"), "utf8");
  assert.match(policySource, /class PolicyEvaluator/);
  assert.match(policySource, /Role\.ADMIN/);
  assert.match(policySource, /Role\.EDITOR/);
  assert.match(policySource, /Role\.VIEWER/);
  assert.match(policySource, /ZoneAction\.READ/);
  assert.match(policySource, /ZoneAction\.WRITE/);
  assert.match(policySource, /ZoneAction\.GRANT/);
});

test("day 8 access service exists for backend registry zone grants and access mapping", () => {
  const accessSource = readFileSync(join(repoRoot, "backend", "app", "access.py"), "utf8");
  assert.match(accessSource, /class AccessService/);
  assert.match(accessSource, /class DatabaseBackendRepository/);
  assert.match(accessSource, /class DatabaseZoneRepository/);
  assert.match(accessSource, /class DatabasePermissionGrantRepository/);
  assert.match(accessSource, /def register_backend/);
  assert.match(accessSource, /def register_zone/);
  assert.match(accessSource, /def sync_backend_zones/);
  assert.match(accessSource, /def assign_zone_grant/);
  assert.match(accessSource, /def list_accessible_zones/);
  assert.match(accessSource, /def list_accessible_backends/);
});

test("day 9 mock adapter flow includes protected backend and zone lists in api and ui", () => {
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const mockAdapterSource = readFileSync(join(repoRoot, "backend", "app", "mock_adapter.py"), "utf8");
  const appSource = readFileSync(join(repoRoot, "frontend", "src", "App.tsx"), "utf8");

  assert.match(mainSource, /@app\.get\(\"\/backends\"/);
  assert.match(mainSource, /@app\.get\(\"\/zones\"/);
  assert.match(mockAdapterSource, /build_mock_access_service/);
  assert.match(appSource, /Sign in to Zonix/);
  assert.match(appSource, /Configured backends/);
  assert.match(appSource, /Accessible zones/);
});

test("day 10 wires a PowerDNS read-only adapter through backend service and UI", () => {
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const powerdnsSource = readFileSync(join(repoRoot, "backend", "app", "powerdns.py"), "utf8");
  const zoneReadSource = readFileSync(join(repoRoot, "backend", "app", "zone_reads.py"), "utf8");
  const appSource = readFileSync(join(repoRoot, "frontend", "src", "App.tsx"), "utf8");
  const compose = readFileSync(join(repoRoot, "deploy", "docker-compose.yml"), "utf8");

  assert.match(mainSource, /@app\.get\(\"\/zones\/\{zone_name\}\"/);
  assert.match(mainSource, /@app\.get\(\"\/zones\/\{zone_name\}\/records\"/);
  assert.match(mainSource, /@app\.post\(\"\/admin\/grants\/zones\"/);
  assert.match(mainSource, /@app\.post\(\s*\"\/admin\/backends\/\{backend_name\}\/zones\/sync\"/);
  assert.match(powerdnsSource, /class PowerDNSReadAdapter/);
  assert.match(zoneReadSource, /class ZoneReadService/);
  assert.match(appSource, /Zone detail/);
  assert.match(appSource, /Record sets/);
  assert.match(compose, /powerdns:/);
});

test("day 11 normalizes RecordSet typing in backend and frontend contracts", () => {
  const domainSource = readFileSync(join(repoRoot, "backend", "app", "domain", "models.py"), "utf8");
  const domainTests = readFileSync(join(repoRoot, "backend", "tests", "test_domain_models.py"), "utf8");
  const apiSource = readFileSync(join(repoRoot, "frontend", "src", "api.ts"), "utf8");

  assert.match(domainSource, /class RecordType/);
  assert.match(domainSource, /def validate_record_values/);
  assert.match(domainTests, /test_record_set_validates_supported_day_11_types/);
  assert.match(apiSource, /recordTypeSchema/);
  assert.match(apiSource, /superRefine/);
});

test("day 12 adds PowerDNS write operations for create update and delete", () => {
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const powerdnsSource = readFileSync(join(repoRoot, "backend", "app", "powerdns.py"), "utf8");
  const recordWriteSource = readFileSync(join(repoRoot, "backend", "app", "record_writes.py"), "utf8");
  const apiTests = readFileSync(join(repoRoot, "backend", "tests", "test_mock_api.py"), "utf8");

  assert.match(mainSource, /@app\.post\(\"\/zones\/\{zone_name\}\/records\"/);
  assert.match(mainSource, /@app\.put\(\"\/zones\/\{zone_name\}\/records\"/);
  assert.match(mainSource, /@app\.delete\(\"\/zones\/\{zone_name\}\/records\"/);
  assert.match(powerdnsSource, /def patch_zone/);
  assert.match(powerdnsSource, /def create_record_set/);
  assert.match(powerdnsSource, /def update_record_set/);
  assert.match(powerdnsSource, /def delete_record_set/);
  assert.match(recordWriteSource, /class RecordWriteService/);
  assert.match(apiTests, /test_editor_can_create_record_for_powerdns_zone/);
  assert.match(apiTests, /test_editor_can_update_existing_record_for_powerdns_zone/);
  assert.match(apiTests, /test_editor_can_delete_existing_record_for_powerdns_zone/);
});

test("day 13 adds audit events for login and record mutations", () => {
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const auditSource = readFileSync(join(repoRoot, "backend", "app", "audit.py"), "utf8");
  const domainSource = readFileSync(join(repoRoot, "backend", "app", "domain", "models.py"), "utf8");
  const authTests = readFileSync(join(repoRoot, "backend", "tests", "test_auth_api.py"), "utf8");
  const apiTests = readFileSync(join(repoRoot, "backend", "tests", "test_mock_api.py"), "utf8");

  assert.match(mainSource, /@app\.get\(\"\/audit\"/);
  assert.match(mainSource, /action=\"login\.success\"/);
  assert.match(mainSource, /action=\"record\.created\"/);
  assert.match(mainSource, /action=\"record\.updated\"/);
  assert.match(mainSource, /action=\"record\.deleted\"/);
  assert.match(auditSource, /class AuditService/);
  assert.match(auditSource, /class DatabaseAuditEventRepository/);
  assert.match(domainSource, /class AuditEvent/);
  assert.match(domainSource, /created_at:/);
  assert.match(authTests, /test_login_sets_session_cookie_and_returns_authenticated_user/);
  assert.match(apiTests, /test_audit_lists_login_and_record_mutations/);
});

test("day 14 adds changeset preview and optimistic locking for record writes", () => {
  const domainSource = readFileSync(join(repoRoot, "backend", "app", "domain", "models.py"), "utf8");
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const recordWriteSource = readFileSync(join(repoRoot, "backend", "app", "record_writes.py"), "utf8");
  const schemasSource = readFileSync(join(repoRoot, "backend", "app", "schemas.py"), "utf8");
  const apiTests = readFileSync(join(repoRoot, "backend", "tests", "test_mock_api.py"), "utf8");

  assert.match(domainSource, /class ChangeOperation/);
  assert.match(domainSource, /class ChangeSet/);
  assert.match(mainSource, /@app\.post\(\"\/zones\/\{zone_name\}\/changes\/preview\"/);
  assert.match(recordWriteSource, /def preview_create_record/);
  assert.match(recordWriteSource, /def preview_update_record/);
  assert.match(recordWriteSource, /def preview_delete_record/);
  assert.match(recordWriteSource, /def record_version/);
  assert.match(recordWriteSource, /class RecordVersionConflictError/);
  assert.match(schemasSource, /class ChangePreviewRequest/);
  assert.match(schemasSource, /class ChangeSetResponse/);
  assert.match(apiTests, /test_preview_update_returns_before_after_and_versions/);
  assert.match(apiTests, /test_update_rejects_stale_expected_version/);
});

test("day 15 fixes a live PowerDNS api flow and internal demo trail", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const quickstart = readFileSync(join(repoRoot, "docs", "quickstart.md"), "utf8");
  const liveFlowTests = readFileSync(
    join(repoRoot, "backend", "tests", "test_powerdns_flow_integration.py"),
    "utf8",
  );

  assert.match(readme, /login -> open zone -> edit record -> audit/);
  assert.match(quickstart, /Day 15 demo flow/);
  assert.match(quickstart, /python -m unittest tests\.test_powerdns_flow_integration/);
  assert.match(liveFlowTests, /test_live_api_flow_login_open_zone_edit_record_and_see_audit/);
});

test("day 16 adds identity provider configuration foundation for generic oidc", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const domainSource = readFileSync(join(repoRoot, "backend", "app", "domain", "models.py"), "utf8");
  const identityProviderSource = readFileSync(
    join(repoRoot, "backend", "app", "identity_providers.py"),
    "utf8",
  );
  const migrationSource = readFileSync(
    join(repoRoot, "backend", "migrations", "0001_initial.sql"),
    "utf8",
  );
  const testsSource = readFileSync(
    join(repoRoot, "backend", "tests", "test_identity_providers.py"),
    "utf8",
  );

  assert.match(readme, /IdentityProvider/);
  assert.match(domainSource, /class IdentityProviderKind/);
  assert.match(domainSource, /client_id:/);
  assert.match(domainSource, /client_secret:/);
  assert.match(domainSource, /claims_mapping_rules:/);
  assert.match(identityProviderSource, /class IdentityProviderService/);
  assert.match(identityProviderSource, /class DatabaseIdentityProviderRepository/);
  assert.match(migrationSource, /scopes TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\]/);
  assert.match(migrationSource, /claims_mapping_rules JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(testsSource, /test_repository_round_trips_oidc_configuration/);
});

test("day 17 implements oidc login start and callback flow", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const mainSource = readFileSync(join(repoRoot, "backend", "app", "main.py"), "utf8");
  const authSource = readFileSync(join(repoRoot, "backend", "app", "auth.py"), "utf8");
  const oidcSource = readFileSync(join(repoRoot, "backend", "app", "oidc.py"), "utf8");
  const authTests = readFileSync(join(repoRoot, "backend", "tests", "test_auth_api.py"), "utf8");

  assert.match(readme, /generic OIDC login start\/callback flow/);
  assert.match(mainSource, /@app\.get\(\"\/auth\/oidc\/providers\"/);
  assert.match(mainSource, /@app\.get\(\"\/auth\/oidc\/\{provider_name\}\/login\"/);
  assert.match(mainSource, /@app\.get\(\"\/auth\/oidc\/\{provider_name\}\/callback\"/);
  assert.match(authSource, /def provision_oidc_user/);
  assert.match(oidcSource, /class OIDCStateManager/);
  assert.match(oidcSource, /class OIDCService/);
  assert.match(authTests, /test_oidc_callback_maps_groups_into_role_and_zone_access/);
});

test("day 18 maps oidc claims and groups into roles and zone access", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const oidcSource = readFileSync(join(repoRoot, "backend", "app", "oidc.py"), "utf8");
  const accessSource = readFileSync(join(repoRoot, "backend", "app", "access.py"), "utf8");
  const authTests = readFileSync(join(repoRoot, "backend", "tests", "test_auth_api.py"), "utf8");
  const identityProviderTests = readFileSync(
    join(repoRoot, "backend", "tests", "test_identity_providers.py"),
    "utf8",
  );

  assert.match(readme, /Day 1-18 milestone path/);
  assert.match(oidcSource, /def map_identity/);
  assert.match(oidcSource, /adminGroups/);
  assert.match(oidcSource, /zoneEditorPattern/);
  assert.match(accessSource, /def sync_zone_grants_for_user/);
  assert.match(authTests, /test_oidc_callback_maps_groups_into_role_and_zone_access/);
  assert.match(identityProviderTests, /test_mapping_promotes_zone_editor_group_into_editor_and_write_grant/);
});

test("oidc runtime path includes migration and bootstrap coverage", () => {
  const migrationsSource = readFileSync(
    join(repoRoot, "backend", "migrations", "0002_identity_provider_oidc_fields.sql"),
    "utf8",
  );
  const bootstrapSource = readFileSync(join(repoRoot, "backend", "app", "bootstrap.py"), "utf8");
  const bootstrapTests = readFileSync(
    join(repoRoot, "backend", "tests", "test_bootstrap.py"),
    "utf8",
  );
  const quickstart = readFileSync(join(repoRoot, "docs", "quickstart.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  assert.match(migrationsSource, /ALTER TABLE identity_providers/);
  assert.match(migrationsSource, /ADD COLUMN IF NOT EXISTS claims_mapping_rules/);
  assert.match(bootstrapSource, /def ensure_bootstrap_oidc_provider/);
  assert.match(bootstrapTests, /test_ensure_bootstrap_oidc_provider_upserts_provider_configuration/);
  assert.match(quickstart, /npm run bootstrap:oidc/);
  assert.equal(packageJson.scripts["bootstrap:oidc"] !== undefined, true);
});

let failed = 0;

for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}

console.log(`\n${tests.length} test(s) passed`);
