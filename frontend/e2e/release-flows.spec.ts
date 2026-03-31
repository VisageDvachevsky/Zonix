import { expect, test, type Page, type Route } from "@playwright/test";

type SessionUser = { username: string; role: "admin" | "editor" | "viewer" } | null;

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers,
  });
}

async function installReleaseMocks(page: Page) {
  let sessionUser: SessionUser = null;
  let recordVersion = "v1";
  let recordValue = "192.0.2.10";
  const auditEvents = [
    {
      actor: "bootstrap",
      action: "record.created",
      zoneName: "example.com",
      backendName: "powerdns-sandbox",
      payload: { name: "www", recordType: "A", values: [recordValue] },
      createdAt: "2026-03-30T00:00:00Z",
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "zonix.tutorial.v1",
      JSON.stringify({
        admin: {
          status: "dismissed_forever",
          completedChapterIds: [],
          activeChapterId: null,
          activeStepId: null,
          lastRouteKind: "zones",
          updatedAt: new Date().toISOString(),
        },
        "oidc.admin": {
          status: "dismissed_forever",
          completedChapterIds: [],
          activeChapterId: null,
          activeStepId: null,
          lastRouteKind: "zones",
          updatedAt: new Date().toISOString(),
        },
      }),
    );
  });

  await page.route("**/admin/users", (route) =>
    fulfillJson(route, {
      items: [
        { username: "admin", role: "admin", authSource: "local", isActive: true },
        { username: "alice", role: "editor", authSource: "local", isActive: true },
      ],
    }),
  );

  await page.route("**/admin/grants/*", (route) => {
    const username = route.request().url().split("/").pop() ?? "alice";
    return fulfillJson(route, {
      items: [{ username, zoneName: "example.com", actions: ["read", "write"] }],
    });
  });

  await page.route("**/admin/identity-providers", (route) =>
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

  await page.route("**/admin/backends", (route) =>
    fulfillJson(route, {
      items: [
        {
          name: "powerdns-sandbox",
          backendType: "powerdns",
          capabilities: ["discoverZones", "readZones", "readRecords", "writeRecords"],
        },
      ],
    }),
  );

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;
    const method = request.method();

    if (pathname === "/api/health" && method === "GET") {
      return fulfillJson(route, {
        status: "ok",
        app: "Zonix API",
        version: "0.1.0",
        environment: "test",
        inventorySync: "ok",
        inventorySyncError: null,
      });
    }

    if (pathname === "/api/auth/settings" && method === "GET") {
      return fulfillJson(route, {
        localLoginEnabled: true,
        oidcEnabled: true,
        oidcSelfSignupEnabled: false,
        csrfEnabled: true,
        sessionCookieName: "zonix_session",
        sessionCookieSameSite: "lax",
        sessionCookieSecure: false,
        sessionTtlSeconds: 43200,
        bootstrapAdminEnabled: true,
      });
    }

    if (pathname === "/api/auth/oidc/providers" && method === "GET") {
      return fulfillJson(route, {
        items: [{ name: "corp-oidc", kind: "oidc" }],
      });
    }

    if (pathname === "/api/auth/me" && method === "GET") {
      return fulfillJson(route, {
        authenticated: sessionUser !== null,
        user: sessionUser,
        csrfToken: sessionUser ? "test-csrf-token" : null,
      });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      sessionUser = { username: "admin", role: "admin" };
      auditEvents.unshift({
        actor: "admin",
        action: "login.success",
        zoneName: null,
        backendName: null,
        payload: { role: "admin" },
        createdAt: "2026-03-30T12:00:00Z",
      });
      return fulfillJson(route, {
        authenticated: true,
        user: sessionUser,
        csrfToken: "test-csrf-token",
      }, 200, {
        "set-cookie": "zonix_csrf_token=test-csrf-token; Path=/; SameSite=Lax",
      });
    }

    if (
      pathname === "/api/auth/oidc/corp-oidc/login" &&
      method === "GET" &&
      searchParams.get("return_to")
    ) {
      sessionUser = { username: "oidc.admin", role: "admin" };
      auditEvents.unshift({
        actor: "oidc.admin",
        action: "login.success",
        zoneName: null,
        backendName: null,
        payload: { role: "admin", authSource: "oidc:corp-oidc" },
        createdAt: "2026-03-30T12:05:00Z",
      });
      return fulfillJson(route, {
        providerName: "corp-oidc",
        authorizationUrl: `${url.origin}/?oidc=1#/zones`,
      }, 200, {
        "set-cookie": "zonix_csrf_token=test-csrf-token; Path=/; SameSite=Lax",
      });
    }

    if (pathname === "/api/backends" && method === "GET") {
      return fulfillJson(route, {
        items: [
          {
            name: "powerdns-sandbox",
            backendType: "powerdns",
            capabilities: ["discoverZones", "readZones", "readRecords", "writeRecords"],
          },
        ],
      });
    }

    if (pathname === "/api/admin/users" && method === "GET") {
      return fulfillJson(route, {
        items: [
          { username: "admin", role: "admin", authSource: "local", isActive: true },
          { username: "alice", role: "editor", authSource: "local", isActive: true },
        ],
      });
    }

    if (pathname.startsWith("/api/admin/grants/") && method === "GET") {
      const username = pathname.split("/").pop() ?? "alice";
      return fulfillJson(route, {
        items: [{ username, zoneName: "example.com", actions: ["read", "write"] }],
      });
    }

    if (pathname === "/api/admin/identity-providers" && method === "GET") {
      return fulfillJson(route, {
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
      });
    }

    if (pathname === "/api/admin/backends" && method === "GET") {
      return fulfillJson(route, {
        items: [
          {
            name: "powerdns-sandbox",
            backendType: "powerdns",
            capabilities: ["discoverZones", "readZones", "readRecords", "writeRecords"],
          },
        ],
      });
    }

    if (pathname === "/api/zones" && method === "GET") {
      return fulfillJson(route, {
        items: [{ name: "example.com", backendName: "powerdns-sandbox" }],
      });
    }

    if (pathname === "/api/zones/example.com" && method === "GET") {
      return fulfillJson(route, {
        name: "example.com",
        backendName: "powerdns-sandbox",
      });
    }

    if (pathname === "/api/zones/example.com/records") {
      if (method === "GET") {
        return fulfillJson(route, {
          items: [
            {
              zoneName: "example.com",
              name: "www",
              recordType: "A",
              ttl: 300,
              version: recordVersion,
              values: [recordValue],
            },
          ],
        });
      }

      if (method === "PUT") {
        const payload = request.postDataJSON() as {
          ttl: number;
          values: string[];
        };
        recordValue = payload.values[0] ?? recordValue;
        recordVersion = "v2";
        auditEvents.unshift({
          actor: sessionUser?.username ?? "unknown",
          action: "record.updated",
          zoneName: "example.com",
          backendName: "powerdns-sandbox",
          payload: { name: "www", recordType: "A", ttl: payload.ttl, values: payload.values },
          createdAt: "2026-03-30T12:10:00Z",
        });
        return fulfillJson(route, {
          zoneName: "example.com",
          name: "www",
          recordType: "A",
          ttl: payload.ttl,
          version: recordVersion,
          values: payload.values,
        });
      }
    }

    if (pathname === "/api/zones/example.com/changes/preview" && method === "POST") {
      const payload = request.postDataJSON() as {
        operation: "create" | "update" | "delete";
        ttl?: number;
        values?: string[];
      };
      return fulfillJson(route, {
        actor: sessionUser?.username ?? "unknown",
        zoneName: "example.com",
        backendName: "powerdns-sandbox",
        operation: payload.operation,
        before: {
          zoneName: "example.com",
          name: "www",
          recordType: "A",
          ttl: 300,
          version: recordVersion,
          values: ["192.0.2.10"],
        },
        after: {
          zoneName: "example.com",
          name: "www",
          recordType: "A",
          ttl: payload.ttl ?? 300,
          version: "preview-version",
          values: payload.values ?? [recordValue],
        },
        expectedVersion: recordVersion,
        currentVersion: null,
        hasConflict: false,
        conflictReason: null,
        summary: "Update www A",
      });
    }

    if (pathname === "/api/audit" && method === "GET") {
      return fulfillJson(route, { items: auditEvents });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Unhandled mock route: ${method} ${pathname}` }),
    });
  });
}

test("local login opens the zone detail flow", async ({ page }) => {
  await installReleaseMocks(page);
  await page.goto("/");

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("local-dev-admin-change-me");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Zone inventory" })).toBeVisible();
  await page.getByRole("button", { name: /example\.com/ }).click();

  await expect(page).toHaveURL(/#\/zones\/example\.com$/);
  await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add record" })).toBeVisible();
});

test("oidc login returns into the authenticated workspace", async ({ page }) => {
  await installReleaseMocks(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in with corp-oidc" }).click();

  await expect(page).toHaveURL(/#\/zones$/);
  await expect(page.getByRole("heading", { name: "Zone inventory" })).toBeVisible();
  await expect(page.getByText("oidc.admin")).toBeVisible();
});

test("record edits require preview and become visible in audit", async ({ page }) => {
  await installReleaseMocks(page);
  await page.goto("/");

  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("local-dev-admin-change-me");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /example\.com/ }).click();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("IPv4 addresses").fill("192.0.2.99");
  await page.getByRole("button", { name: "Preview changes" }).click();

  await expect(page.getByRole("heading", { name: /Preview record update/i })).toBeVisible();
  await page.getByRole("button", { name: "Apply update" }).click();

  await expect(page.getByText("Record updated")).toBeVisible();
  await expect(page.getByText("192.0.2.99")).toBeVisible();

  await page.getByRole("link", { name: "Audit" }).click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await expect(page.getByTitle("record.updated")).toBeVisible();
  await expect(page.getByText("192.0.2.99")).toBeVisible();
});
