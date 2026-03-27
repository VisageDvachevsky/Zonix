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

test("fixed stack is documented in the delivery plan", () => {
  const plan = readFileSync(join(repoRoot, "plan.txt"), "utf8");
  assert.match(plan, /React \+ TypeScript \+ TanStack Query \+ Zod/);
  assert.match(plan, /FastAPI \+ Pydantic/);
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
