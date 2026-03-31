import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  assignAdminZoneGrant,
  createZoneRecord,
  deleteZoneRecord,
  discoverAdminBackendZones,
  fetchAuditEvents,
  fetchSession,
  fetchZoneRecords,
  importAdminBackendZones,
  logout,
  previewZoneChange,
  startOidcLogin,
} from "./api";

vi.mock("./api", () => ({
  recordTypeSchema: {
    options: ["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "NS", "PTR", "CAA", "SOA"],
  },
  recordDraftSchema: {
    safeParse: vi.fn((value: unknown) => ({
      success: true,
      data: value,
    })),
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
  hasCookie: vi.fn((name: string) =>
    document.cookie
      .split(";")
      .map((part) => part.trim())
      .some((part) => part.startsWith(`${name}=`)),
  ),
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
        capabilities: ["readZones", "readRecords", "writeRecords", "discoverZones"],
      },
    ],
  })),
  fetchZones: vi.fn(async () => ({
    items: [
      { name: "example.com", backendName: "powerdns-sandbox" },
      { name: "lab.example", backendName: "bind-lab" },
    ],
  })),
  fetchZone: vi.fn(async (zoneName: string) => ({
    name: zoneName,
    backendName: zoneName === "example.com" ? "powerdns-sandbox" : "bind-lab",
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
  previewZoneChange: vi.fn(async (input: {
    operation: "create" | "update" | "delete";
    zoneName: string;
    name: string;
    recordType: string;
    ttl?: number;
    values?: string[];
  }) => ({
    actor: "admin",
    zoneName: input.zoneName,
    backendName: "powerdns-sandbox",
    operation: input.operation,
    before:
      input.operation === "create"
        ? null
        : {
            zoneName: input.zoneName,
            name: input.name,
            recordType: input.recordType,
            ttl: 300,
            version: "www-version",
            values: ["192.0.2.10"],
          },
    after:
      input.operation === "delete"
        ? null
        : {
            zoneName: input.zoneName,
            name: input.name,
            recordType: input.recordType,
            ttl: input.ttl ?? 300,
            version: "preview-version",
            values: input.values ?? [],
          },
    expectedVersion: input.operation === "update" ? "www-version" : null,
    currentVersion: null,
    hasConflict: false,
    conflictReason: null,
    summary: `${input.operation} ${input.name}`,
  })),
  createZoneRecord: vi.fn(async (input: {
    zoneName: string;
    name: string;
    recordType: string;
    ttl: number;
    values: string[];
  }) => ({
    zoneName: input.zoneName,
    name: input.name,
    recordType: input.recordType,
    ttl: input.ttl,
    version: "created-version",
    values: input.values,
  })),
  updateZoneRecord: vi.fn(),
  deleteZoneRecord: vi.fn(),
  applyBulkZoneChanges: vi.fn(async ({ zoneName, items }: { zoneName: string; items: unknown[] }) => ({
    zoneName,
    applied: true,
    hasConflicts: false,
    items,
  })),
  fetchAuditEvents: vi.fn(async () => ({
    items: [
      {
        actor: "admin",
        action: "record.created",
        zoneName: "example.com",
        backendName: "powerdns-sandbox",
        payload: { name: "mail", recordType: "MX" },
        createdAt: "2026-03-30T00:00:00Z",
      },
      {
        actor: "alice",
        action: "login.success",
        zoneName: null,
        backendName: null,
        payload: { authSource: "oidc:corp-oidc" },
        createdAt: "2026-03-29T12:00:00Z",
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
  fetchAdminIdentityProviders: vi.fn(async () => ({
    items: [
      {
        name: "corp-oidc",
        issuer: "https://issuer.example",
        clientId: "zonix-ui",
        scopes: ["openid", "profile", "email"],
        hasClientSecret: true,
        claimsMappingRules: { rolesClaim: "groups" },
      },
    ],
  })),
  fetchAdminZoneGrants: vi.fn(async () => ({
    items: [
      {
        username: "alice",
        zoneName: "example.com",
        actions: ["read", "write"],
      },
    ],
  })),
  createAdminBackend: vi.fn(),
  deleteAdminBackend: vi.fn(),
  createAdminIdentityProvider: vi.fn(),
  deleteAdminIdentityProvider: vi.fn(),
  updateAdminUserRole: vi.fn(),
  assignAdminZoneGrant: vi.fn(async (input: {
    username: string;
    zoneName: string;
    actions: string[];
  }) => ({
    username: input.username,
    zoneName: input.zoneName,
    actions: input.actions,
  })),
  discoverAdminBackendZones: vi.fn(async (backendName: string) => ({
    backendName,
    items: [
      { name: "example.com", backendName, managed: true },
      { name: "new.example", backendName, managed: false },
    ],
  })),
  importAdminBackendZones: vi.fn(async ({ backendName, zoneNames }: { backendName: string; zoneNames?: string[] }) => ({
    backendName,
    importedZones: (zoneNames ?? []).map((name) => ({ name, backendName })),
  })),
  syncAdminBackendZones: vi.fn(async (backendName: string) => ({
    backendName,
    syncedZones: [{ name: "example.com", backendName }],
  })),
}));

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

function navigateToHash(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

describe("App", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.clear();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        assign: vi.fn(),
        origin: "http://localhost:5173",
        href: "http://localhost:5173/",
        hash: "",
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
    vi.clearAllMocks();
  });

  it("renders the login shell with OIDC entry", async () => {
    renderApp();

    expect(screen.getByRole("heading", { name: /zonix control plane/i })).toBeVisible();
    expect(await screen.findByRole("button", { name: /sign in with corp-oidc/i })).toBeVisible();
  });

  it("does not request the session endpoint without a session cookie", async () => {
    renderApp();

    expect(screen.getByRole("heading", { name: /zonix control plane/i })).toBeVisible();
    await waitFor(() => {
      expect(vi.mocked(fetchSession)).not.toHaveBeenCalled();
    });
  });

  it("switches the shell copy to russian from the login surface", async () => {
    renderApp();

    fireEvent.click(screen.getByRole("button", { name: "RU" }));

    expect(await screen.findByRole("button", { name: /^войти$/i })).toBeVisible();
    expect(screen.getByText(/фронтенд-оболочка/i)).toBeVisible();
    expect(screen.getByLabelText(/тема/i)).toBeVisible();
  });

  it("starts OIDC login from the login shell", async () => {
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: /sign in with corp-oidc/i }));

    await waitFor(() => {
      expect(startOidcLogin).toHaveBeenCalled();
      expect(vi.mocked(startOidcLogin).mock.calls[0]?.[0]).toEqual({
        providerName: "corp-oidc",
        returnTo: "http://localhost:5173/",
      });
      expect(window.location.assign).toHaveBeenCalledWith(
        "http://localhost:9000/authorize?state=test-state",
      );
    });
  });

  it("preserves the requested admin route after local login", async () => {
    navigateToHash("#/admin/access");
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByRole("heading", { name: /users, roles, and zone grants/i }),
    ).toBeVisible();
    expect(window.location.hash).toBe("#/admin/access");
  });

  it("navigates from zones list to zone detail after login", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/zones/example.com");

    expect(await screen.findByRole("heading", { name: /^example.com$/i })).toBeVisible();
    expect(await screen.findByText(/record table/i)).toBeVisible();
    expect(screen.getByText(/powerdns-sandbox/i)).toBeVisible();
  });

  it("keeps zone workspace visible when record inventory fails", async () => {
    vi.mocked(fetchZoneRecords).mockRejectedValueOnce(
      new Error("backend read failed: disk I/O error"),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();

    navigateToHash("#/zones/example.com");

    expect(await screen.findByRole("heading", { name: /^example.com$/i })).toBeVisible();
    expect(await screen.findByText(/record table is unavailable/i)).toBeVisible();
    expect(screen.getByText(/backend read failed: disk I\/O error/i)).toBeVisible();
  });

  it("opens record editor with type-specific MX fields and applies preview", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/zones/example.com");
    expect(await screen.findByRole("heading", { name: /^example.com$/i })).toBeVisible();

    fireEvent.click(await screen.findByRole("button", { name: /add record/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "mail" },
    });
    fireEvent.change(screen.getByLabelText(/record type/i), {
      target: { value: "MX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add mx value/i }));
    fireEvent.change(screen.getByPlaceholderText("10"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByPlaceholderText("mail.example.com…"), {
      target: { value: "mail.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /preview changes/i }));

    await waitFor(() => {
      expect(previewZoneChange).toHaveBeenCalled();
      expect(vi.mocked(previewZoneChange).mock.calls[0]?.[0]).toEqual({
        operation: "create",
        zoneName: "example.com",
        name: "mail",
        recordType: "MX",
        ttl: 300,
        values: ["10 mail.example.com"],
        expectedVersion: undefined,
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: /apply create/i }));

    await waitFor(() => {
      expect(createZoneRecord).toHaveBeenCalled();
      expect(vi.mocked(createZoneRecord).mock.calls[0]?.[0]).toEqual({
        zoneName: "example.com",
        name: "mail",
        recordType: "MX",
        ttl: 300,
        values: ["10 mail.example.com"],
      });
    });
  });

  it("removes a deleted record from the visible table before refetch completes", async () => {
    vi.mocked(fetchZoneRecords)
      .mockImplementationOnce(async () => ({
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
            name: "day33-proof",
            recordType: "A",
            ttl: 300,
            version: "day33-proof-version",
            values: ["192.0.2.55"],
          },
        ],
      }))
      .mockImplementationOnce(
        () =>
          new Promise(() => {
            // Keep the refetch pending so the assertion relies on cache updates.
          }),
      );
    vi.mocked(deleteZoneRecord).mockResolvedValueOnce(undefined);

    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();

    navigateToHash("#/zones/example.com");
    expect(await screen.findByRole("heading", { name: /^example.com$/i })).toBeVisible();

    fireEvent.change(screen.getByLabelText(/search records/i), {
      target: { value: "day33-proof" },
    });
    expect(await screen.findByText("day33-proof")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(await screen.findByRole("heading", { name: /preview delete/i })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /apply delete/i }));

    await waitFor(() => {
      expect(vi.mocked(deleteZoneRecord).mock.calls[0]?.[0]).toEqual({
        zoneName: "example.com",
        name: "day33-proof",
        recordType: "A",
        expectedVersion: "day33-proof-version",
      });
      expect(screen.queryByText("day33-proof")).not.toBeInTheDocument();
    });
  });

  it("renders audit page with filters", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/audit");

    expect(await screen.findByRole("heading", { name: /audit log/i })).toBeVisible();
    expect(screen.getByLabelText(/filter audit by actor/i)).toBeVisible();
    expect(screen.getByLabelText(/filter audit by zone/i)).toBeVisible();
    expect(screen.getByLabelText(/search audit events/i)).toBeVisible();
    expect(await screen.findByText(/OIDC · corp-oidc/i)).toBeVisible();
  });

  it("manages zone grants from the standalone access page", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/admin/access");

    expect(await screen.findByRole("heading", { name: /users, roles, and zone grants/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /alice/i })).toBeVisible();
    expect(screen.getByLabelText(/grant user/i)).toHaveValue("alice");
    expect(screen.getByRole("button", { name: /save zone grant/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /alice/i }));
    fireEvent.change(screen.getByLabelText(/grant zone/i), {
      target: { value: "lab.example" },
    });
    fireEvent.click(screen.getByLabelText(/^write$/i));
    fireEvent.click(screen.getByRole("button", { name: /save zone grant/i }));

    await waitFor(() => {
      expect(assignAdminZoneGrant).toHaveBeenCalled();
      expect(vi.mocked(assignAdminZoneGrant).mock.calls[0]?.[0]).toEqual({
        username: "alice",
        zoneName: "lab.example",
        actions: ["read", "write"],
      });
    });
  });

  it("discovers and imports zones from backend config page", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/admin/backends");
    expect(await screen.findByRole("heading", { name: /backend config/i })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /discover zones/i }));

    expect(await screen.findByText(/new.example/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /import selected \(1\)/i }));

    await waitFor(() => {
      expect(discoverAdminBackendZones).toHaveBeenCalled();
      expect(vi.mocked(importAdminBackendZones).mock.calls[0]?.[0]).toEqual({
        backendName: "powerdns-sandbox",
        zoneNames: ["new.example"],
      });
    });
  });

  it("marks manual backends as non-discoverable in admin backend config", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/admin/backends");
    expect(await screen.findByRole("heading", { name: /backend config/i })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /bind-lab/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sync zones/i })).toBeDisabled();
    });
  });

  it("shows a search-specific empty state on zones page and clears it", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();

    fireEvent.change(screen.getByLabelText(/search zones/i), {
      target: { value: "missing-zone" },
    });

    expect(await screen.findByText(/no zones match this search/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));

    await waitFor(() => {
      expect(screen.queryByText(/no zones match this search/i)).not.toBeInTheDocument();
    });
  });

  it("shows backend error details on zone detail failures", async () => {
    vi.mocked(fetchZoneRecords).mockRejectedValueOnce(new Error("Backend timed out while loading records"));
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/zones/example.com");

    expect(await screen.findByText(/backend timed out while loading records/i)).toBeVisible();
  });

  it("shows a readable error state for an unknown zone route", async () => {
    const { fetchZone } = await import("./api");
    vi.mocked(fetchZone).mockRejectedValueOnce(
      new Error("Zone detail failed with status 404"),
    );

    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/zones/does-not-exist.example");

    expect(await screen.findByText(/zone detail is unavailable/i)).toBeVisible();
    expect(screen.getByText(/zone detail failed with status 404/i)).toBeVisible();
  });

  it("shows filter empty state on audit page and resets filters", async () => {
    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();
    navigateToHash("#/audit");
    expect(await screen.findByRole("heading", { name: /audit log/i })).toBeVisible();

    fireEvent.change(screen.getByLabelText(/search audit events/i), {
      target: { value: "missing-action" },
    });

    expect(await screen.findByText(/no audit events match the current filters/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    await waitFor(() => {
      expect(screen.queryByText(/no audit events match the current filters/i)).not.toBeInTheDocument();
      expect(screen.getByText(/record.created/i)).toBeVisible();
    });
  });

  it("does not refetch session after logout", async () => {
    const fetchSessionMock = vi.mocked(fetchSession);

    renderApp();

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("heading", { name: /zone inventory/i })).toBeVisible();

    const callsBeforeLogout = fetchSessionMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("button", { name: /^sign in$/i })).toBeVisible();
    await waitFor(() => {
      expect(vi.mocked(logout)).toHaveBeenCalledTimes(1);
      expect(fetchSessionMock.mock.calls.length).toBe(callsBeforeLogout);
      expect(screen.getByLabelText(/password/i)).toHaveValue("");
    });
  });
});
