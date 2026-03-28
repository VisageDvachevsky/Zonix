import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ZodError } from "zod";

import { App } from "./App";
import { recordDraftSchema } from "./api";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();

  return {
    ...actual,
  fetchHealth: vi.fn(async () => ({
    status: "ok",
    app: "Zonix API",
    version: "0.1.0",
    environment: "test",
    inventorySync: "ok",
    inventorySyncError: null,
  })),
  fetchSession: vi.fn(async () => ({ authenticated: false, user: null })),
  login: vi.fn(async () => ({
    authenticated: true,
    user: { username: "admin", role: "admin" },
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
        capabilities: ["readZones"],
      },
    ],
  })),
  fetchZones: vi.fn(async () => ({
    items: [
      { name: "example.com", backendName: "powerdns-sandbox" },
      { name: "lab.example", backendName: "bind-lab" },
    ],
  })),
  fetchZone: vi.fn(async () => ({
    name: "example.com",
    backendName: "powerdns-sandbox",
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
  createAdminBackend: vi.fn(),
  createAdminIdentityProvider: vi.fn(),
  assignAdminZoneGrant: vi.fn(),
  syncAdminBackendZones: vi.fn(),
  deleteAdminBackend: vi.fn(),
  deleteAdminIdentityProvider: vi.fn(),
  updateAdminUserRole: vi.fn(),
  };
});

describe("App", () => {
  it("renders the login form when no active session exists", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: /sign in to zonix/i }),
    ).toBeVisible();
    expect(await screen.findByText("Zonix API")).toBeVisible();
    expect(screen.getByLabelText(/username/i)).toBeVisible();
    expect(screen.getByLabelText(/password/i)).toBeVisible();
  });

  it("shows live zone detail and records after login", async () => {
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
      await screen.findByRole("heading", { name: "Control plane workspace" }),
    ).toBeVisible();
    expect(
      (await screen.findAllByText("powerdns-sandbox")).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("Choose a zone.")).toBeVisible();
    expect((await screen.findAllByText("example.com")).length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("Current zone inventory.")).toBeVisible();
    expect(await screen.findByText("www")).toBeVisible();
    expect(await screen.findByText("A")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /open admin/i }));
    expect(await screen.findByRole("heading", { name: "Backends" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Backend configs" })).toBeVisible();

    const adminTabs = screen.getByRole("tablist", { name: "Admin sections" });
    fireEvent.click(within(adminTabs).getByRole("tab", { name: "Identity" }));
    expect(await screen.findByRole("heading", { name: "OIDC configs" })).toBeVisible();

    fireEvent.click(within(adminTabs).getByRole("tab", { name: "Access" }));
    expect(
      await screen.findByRole("heading", { name: "Access for example.com" }),
    ).toBeVisible();
    expect(await screen.findByText(/zone context: example.com/i)).toBeVisible();
  });

  it("validates typed record sets with the shared frontend schema", () => {
    expect(
      recordDraftSchema.parse({
        zoneName: "example.com",
        name: "www",
        recordType: "a",
        ttl: 300,
        values: ["192.0.2.10"],
      }).recordType,
    ).toBe("A");

    expect(() =>
      recordDraftSchema.parse({
        zoneName: "example.com",
        name: "www",
        recordType: "A",
        ttl: 300,
        values: ["not-an-ip"],
      }),
    ).toThrow(ZodError);
  });
});
