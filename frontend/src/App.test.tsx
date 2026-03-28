import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ZodError } from "zod";

import { App } from "./App";
import { recordDraftSchema, startOidcLogin } from "./api";

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
    createAdminBackend: vi.fn(),
    createAdminIdentityProvider: vi.fn(),
    createZoneRecord: vi.fn(),
    updateZoneRecord: vi.fn(),
    deleteZoneRecord: vi.fn(),
    assignAdminZoneGrant: vi.fn(),
    syncAdminBackendZones: vi.fn(),
    deleteAdminBackend: vi.fn(),
    deleteAdminIdentityProvider: vi.fn(),
    updateAdminUserRole: vi.fn(),
  };
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

    fireEvent.click(screen.getByRole("button", { name: /^auth$/i }));
    expect(
      await screen.findByRole("heading", { name: /auth hardening/i }),
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
