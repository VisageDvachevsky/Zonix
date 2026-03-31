import { expect, test, type Page, type Route } from "@playwright/test";

async function fulfillJson(
  route: Route,
  body: unknown,
  headers?: Record<string, string>,
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers,
  });
}

async function mockApi(page: Page) {
  let authenticated = false;

  await page.route("**/api/health", (route) =>
    fulfillJson(route, {
      status: "ok",
      app: "Zonix API",
      version: "0.1.0",
      environment: "test",
      inventorySync: "ok",
      inventorySyncError: null,
    }),
  );

  await page.route("**/api/auth/settings", (route) =>
    fulfillJson(route, {
      localLoginEnabled: true,
      oidcEnabled: false,
      oidcSelfSignupEnabled: false,
      csrfEnabled: true,
      sessionCookieName: "zonix_session",
      sessionCookieSameSite: "lax",
      sessionCookieSecure: false,
      sessionTtlSeconds: 43200,
      bootstrapAdminEnabled: true,
    }),
  );

  await page.route("**/api/auth/me", (route) =>
    fulfillJson(route, {
      authenticated,
      user: authenticated ? { username: "admin", role: "admin" } : null,
      csrfToken: authenticated ? "test-csrf-token" : null,
    }),
  );

  await page.route("**/api/auth/login", async (route) => {
    authenticated = true;
    await fulfillJson(route, {
      authenticated: true,
      user: { username: "admin", role: "admin" },
      csrfToken: "test-csrf-token",
    }, {
      "set-cookie": "zonix_csrf_token=test-csrf-token; Path=/; SameSite=Lax",
    });
  });

  await page.route("**/api/backends", (route) =>
    fulfillJson(route, {
      items: [
        {
          name: "powerdns-sandbox",
          backendType: "powerdns",
          capabilities: ["readZones", "readRecords", "writeRecords", "discoverZones"],
        },
      ],
    }),
  );

  await page.route("**/api/admin/backends", (route) =>
    fulfillJson(route, {
      items: [
        {
          name: "powerdns-sandbox",
          backendType: "powerdns",
          capabilities: ["readZones", "readRecords", "writeRecords", "discoverZones"],
        },
      ],
    }),
  );

  await page.route("**/api/zones/example.com/records", (route) =>
    fulfillJson(route, {
      items: [
        {
          zoneName: "example.com",
          name: "www",
          recordType: "A",
          ttl: 300,
          version: "v1",
          values: ["192.0.2.10"],
        },
      ],
    }),
  );

  await page.route("**/api/zones/example.com", (route) =>
    fulfillJson(route, {
      name: "example.com",
      backendName: "powerdns-sandbox",
    }),
  );

  await page.route("**/api/zones", (route) =>
    fulfillJson(route, {
      items: [{ name: "example.com", backendName: "powerdns-sandbox" }],
    }),
  );

  await page.route("**/api/audit?limit=250", (route) =>
    fulfillJson(route, {
      items: [
        {
          actor: "admin",
          action: "record.updated",
          zoneName: "example.com",
          backendName: "powerdns-sandbox",
          payload: { name: "www", recordType: "A" },
          createdAt: "2026-03-30T00:00:00Z",
        },
      ],
    }),
  );

  await page.route("**/api/admin/users", (route) =>
    fulfillJson(route, {
      items: [
        { username: "admin", role: "admin", authSource: "local", isActive: true },
        { username: "alice", role: "editor", authSource: "oidc:corp-oidc", isActive: true },
      ],
    }),
  );

  await page.route("**/api/admin/grants/alice", (route) =>
    fulfillJson(route, {
      items: [{ username: "alice", zoneName: "example.com", actions: ["read", "write"] }],
    }),
  );

  await page.route("**/api/admin/identity-providers", (route) =>
    fulfillJson(route, {
      items: [
        {
          name: "corp-oidc",
          kind: "oidc",
          issuer: "https://issuer.example",
          clientId: "zonix-ui",
          scopes: ["openid", "profile", "email"],
          hasClientSecret: true,
          claimsMappingRules: { rolesClaim: "groups" },
        },
      ],
    }),
  );
}

test("tutorial drives shell, zones, and zone detail with anchored modals", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Welcome to Zonix")).toBeVisible();
  await page.getByRole("button", { name: "Start walkthrough" }).click();

  await expect(page.getByText("Navigation is split by operator tasks")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("The shell header keeps session context visible")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Zones are the main operator entry point")).toBeVisible();
  await page.getByRole("button", { name: "Open zones" }).click();

  await expect(page.getByText("Search cuts across zone name and backend owner")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Zone cards answer three questions immediately")).toBeVisible();
  await page.getByRole("button", { name: "Continue to zone detail" }).click();

  await expect(page).toHaveURL(/#\/zones\/example\.com$/);
  await expect(page.getByText("Zone detail keeps the backend context visible")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("Writes start with preview, not blind apply")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByText("The record table is the operational truth surface")).toBeVisible();
});

test("manual launcher remains available after never show again", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("admin");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Welcome to Zonix")).toBeVisible();
  await page.getByRole("button", { name: "Never show again" }).click();

  await page.getByRole("button", { name: "Learn the workspace" }).click();
  await expect(page.getByText("Tutorials")).toBeVisible();
  await expect(page.getByText("Chapter library")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Welcome to Zonix")).not.toBeVisible();
  await page.getByRole("button", { name: "Learn the workspace" }).click();
  await expect(page.getByText("Tutorials")).toBeVisible();
});
