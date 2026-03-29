import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";

import { App } from "./App";
import {
  applyBulkZoneChanges,
  createAdminServiceAccount,
  createAdminServiceAccountToken,
  discoverAdminBackendZones,
  importAdminBackendZones,
  startOidcLogin,
} from "./api";

vi.mock("./api", () => {
  return {
    recordTypeSchema: {
      options: ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA", "SOA"],
    },
    fetchHealth: vi.fn(async () => ({
      status: "ok",
      app: "Zonix API",
      version: "0.1.0",
      environment: "test",
      inventorySync: "ok",
      inventorySyncError: null,
    })),
    fetchAuthSettings: vi.fn(async () => ({
      localLoginEnabled: true,
      oidcEnabled: true,
      oidcSelfSignupEnabled: false,
      csrfEnabled: true,
      sessionCookieName: "zonix_session",
      sessionCookieSameSite: "lax",
      sessionCookieSecure: false,
      sessionTtlSeconds: 43200,
      bootstrapAdminEnabled: true,
    })),
    fetchSession: vi.fn(async () => ({ authenticated: false, user: null })),
    fetchOidcProviders: vi.fn(async () => ({
      items: [{ name: "corp-oidc", kind: "oidc" }],
    })),
    login: vi.fn(async () => ({
      authenticated: true,
      user: { username: "admin", role: "admin" },
    })),
    startOidcLogin: vi.fn(async () => ({
      providerName: "corp-oidc",
      authorizationUrl: "http://localhost:9000/authorize?state=test-state",
    })),
    logout: vi.fn(async () => ({ authenticated: false, user: null })),
    fetchBackends: vi.fn(async () => ({
      items: [
        {
          name: "bind-lab",
          backendType: "rfc2136-bind",
          capabilities: ["readZones"],
        },
        {
          name: "powerdns-sandbox",
          backendType: "powerdns",
          capabilities: ["readZones", "readRecords", "writeRecords"],
        },
      ],
    })),
    fetchZones: vi.fn(async () => ({
      items: [
        { name: "example.com", backendName: "powerdns-sandbox" },
        { name: "lab.example", backendName: "bind-lab" },
      ],
    })),
    fetchZoneRecords: vi.fn(async () => ({
      items: [
        {
          zoneName: "example.com",
          name: "@",
          recordType: "SOA",
          ttl: 3600,
          version: "soa-version",
          values: [
            "ns1.example.com hostmaster.example.com 1 3600 600 1209600 3600",
          ],
        },
        {
          zoneName: "example.com",
          name: "www",
          recordType: "A",
          ttl: 300,
          version: "www-version",
          values: ["192.0.2.10"],
        },
      ],
    })),
    fetchAdminUsers: vi.fn(async () => ({
      items: [
        {
          username: "admin",
          role: "admin",
          authSource: "local",
          isActive: true,
        },
        {
          username: "alice",
          role: "editor",
          authSource: "oidc:corp-oidc",
          isActive: true,
        },
      ],
    })),
    fetchAdminBackends: vi.fn(async () => ({
      items: [
        {
          name: "bind-lab",
          backendType: "rfc2136-bind",
          capabilities: ["readZones", "rfc2136Update"],
        },
        {
          name: "powerdns-sandbox",
          backendType: "powerdns",
          capabilities: ["readZones", "readRecords", "writeRecords"],
        },
      ],
    })),
    fetchAdminIdentityProviders: vi.fn(async () => ({
      items: [
        {
          name: "corp-oidc",
          kind: "oidc",
          issuer: "https://issuer.example",
          clientId: "zonix-ui",
          hasClientSecret: true,
          scopes: ["openid", "profile", "email"],
          claimsMappingRules: { rolesClaim: "groups" },
        },
      ],
    })),
    fetchAdminZoneGrants: vi.fn(async () => ({
      items: [
        {
          username: "admin",
          zoneName: "example.com",
          actions: ["read", "write", "grant"],
        },
      ],
    })),
    fetchAdminServiceAccounts: vi.fn(async () => ({
      items: [
        {
          username: "svc-robot",
          role: "editor",
          authSource: "service-account",
          isActive: true,
        },
      ],
    })),
    createAdminBackend: vi.fn(),
    createAdminIdentityProvider: vi.fn(),
    createAdminServiceAccount: vi.fn(async (input) => ({
      username: input.username,
      role: input.role,
      authSource: "service-account",
      isActive: true,
    })),
    createAdminServiceAccountToken: vi.fn(async ({ username, name }) => ({
      username,
      tokenName: name,
      token: "zonix_tok_test_token",
    })),
    createZoneRecord: vi.fn(),
    updateZoneRecord: vi.fn(),
    deleteZoneRecord: vi.fn(),
    applyBulkZoneChanges: vi.fn(async ({ zoneName, items }) => ({
      zoneName,
      applied: true,
      hasConflicts: false,
      items: items.map((item: { operation: string; name: string; expectedVersion?: string }) => ({
        actor: "admin",
        zoneName,
        backendName: "powerdns-sandbox",
        operation: item.operation,
        before: null,
        after: null,
        expectedVersion: item.expectedVersion ?? null,
        currentVersion: null,
        hasConflict: false,
        conflictReason: null,
        summary: `${item.operation} ${item.name}`,
      })),
    })),
    discoverAdminBackendZones: vi.fn(async (backendName) => ({
      backendName,
      items: [
        { name: "example.com", backendName, managed: true },
        { name: "new.example", backendName, managed: false },
      ],
    })),
    importAdminBackendZones: vi.fn(async ({ backendName, zoneNames }) => ({
      backendName,
      importedZones: (zoneNames ?? []).map((name: string) => ({
        name,
        backendName,
      })),
    })),
    assignAdminZoneGrant: vi.fn(),
    syncAdminBackendZones: vi.fn(),
    deleteAdminBackend: vi.fn(),
    deleteAdminIdentityProvider: vi.fn(),
    updateAdminUserRole: vi.fn(),
  };
});

const frontendRecordDraftSchema = z
  .object({
    zoneName: z.string().min(1),
    name: z.string().min(1),
    recordType: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }
      return value.toUpperCase();
    }, z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA", "SOA"])),
    ttl: z.number().int().positive(),
    values: z.array(z.string().min(1)),
  })
  .superRefine((record, ctx) => {
    if (record.recordType !== "A") {
      return;
    }

    for (const value of record.values) {
      const octets = value.split(".");
      const valid =
        octets.length === 4 &&
        octets.every((octet) => /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255);
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid A record value: ${value}`,
          path: ["values"],
        });
      }
    }
  });

describe("App", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: vi.fn(),
        origin: "http://localhost:5173",
      },
    });
    window.confirm = vi.fn(() => true);
  });

  afterAll(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("renders the hardened login screen when no session exists", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: /zonix control plane/i }),
    ).toBeVisible();
    expect(screen.getByLabelText(/username/i)).toBeVisible();
    expect(screen.getByLabelText(/password/i)).toBeVisible();
    expect(await screen.findByText(/api status/i)).toBeVisible();
    expect(screen.getByText(/inventory sync/i)).toBeVisible();
    expect(screen.getByText(/csrf/i)).toBeVisible();
    expect(await screen.findByRole("button", { name: /sign in with corp-oidc/i })).toBeVisible();
  });

  it("starts browser OIDC login from the hardened login screen", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /sign in with corp-oidc/i }));

    await waitFor(() => {
      expect(startOidcLogin).toHaveBeenCalled();
      expect(vi.mocked(startOidcLogin).mock.calls[0]?.[0]).toEqual({
        providerName: "corp-oidc",
        returnTo: "http://localhost:5173",
      });
      expect(window.location.assign).toHaveBeenCalledWith(
        "http://localhost:9000/authorize?state=test-state",
      );
    });
  });

  it("shows the records workspace and top-level tabs after login", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("heading", { name: /zone inventory/i }),
    ).toBeVisible();
    expect((await screen.findAllByText("powerdns-sandbox")).length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("www")).toBeVisible();
    expect(await screen.findByText("192.0.2.10")).toBeVisible();
    expect(
      (await screen.findAllByRole("button", { name: /sync backend zones/i }))
        .length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^operations$/i }));
    expect(
      await screen.findByRole("heading", { name: /backend inventory/i }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: /discover and import zones/i }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^auth$/i }));
    expect(
      await screen.findByRole("heading", { name: /auth hardening/i }),
    ).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: /service accounts and tokens/i }),
    ).toBeVisible();
  });

  it("opens an inline add-record row from the main workspace", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("heading", { name: /zone inventory/i });

    let enabledAddRecordButton: HTMLElement | undefined;
    await waitFor(async () => {
      enabledAddRecordButton = (
        await screen.findAllByRole("button", { name: /^add record$/i })
      ).find((button) => !button.hasAttribute("disabled"));
      expect(enabledAddRecordButton).toBeDefined();
    });

    fireEvent.click(enabledAddRecordButton!);

    expect(await screen.findByLabelText(/^name$/i)).toHaveValue("@");
    expect(await screen.findByPlaceholderText(/one value per line/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeVisible();
  });

  it("applies bulk delete from the records workspace", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("heading", { name: /zone inventory/i });
    fireEvent.click(await screen.findByLabelText(/select www a/i));
    fireEvent.click(screen.getByRole("button", { name: /bulk delete \(1\)/i }));

    await waitFor(() => {
      expect(applyBulkZoneChanges).toHaveBeenCalledWith(
        {
          zoneName: "example.com",
          items: [
            {
              operation: "delete",
              name: "www",
              recordType: "A",
              expectedVersion: "www-version",
            },
          ],
        },
        expect.anything(),
      );
    });
  });

  it("discovers and imports zones from the operations tab", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^operations$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /discover zones/i }));

    expect(await screen.findByText("new.example")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /import selected \(1\)/i }));

    await waitFor(() => {
      expect(discoverAdminBackendZones).toHaveBeenCalled();
      expect(importAdminBackendZones).toHaveBeenCalledWith(
        {
          backendName: "bind-lab",
          zoneNames: ["new.example"],
        },
        expect.anything(),
      );
    });
  });

  it("creates a service account and issues an api token from the auth tab", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^auth$/i }));

    fireEvent.change(await screen.findByLabelText(/service account username/i), {
      target: { value: "svc-ci" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create service account/i }));

    fireEvent.change(await screen.findByLabelText(/service account token name/i), {
      target: { value: "ci-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: /issue api token/i }));

    await waitFor(() => {
      expect(createAdminServiceAccount).toHaveBeenCalledWith(
        {
          username: "svc-ci",
          role: "editor",
        },
        expect.anything(),
      );
      expect(createAdminServiceAccountToken).toHaveBeenCalledWith(
        {
          username: "svc-robot",
          name: "ci-token",
        },
        expect.anything(),
      );
    });
    expect(await screen.findByText(/zonix_tok_test_token/i)).toBeVisible();
  });

  it("validates typed record sets with the shared frontend schema", () => {
    expect(
      frontendRecordDraftSchema.parse({
        zoneName: "example.com",
        name: "www",
        recordType: "a",
        ttl: 300,
        values: ["192.0.2.10"],
      }).recordType,
    ).toBe("A");

    expect(() =>
      frontendRecordDraftSchema.parse({
        zoneName: "example.com",
        name: "www",
        recordType: "A",
        ttl: 300,
        values: ["not-an-ip"],
      }),
    ).toThrow(ZodError);
  });
});
