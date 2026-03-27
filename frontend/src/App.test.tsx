import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { App } from "./App";

vi.mock("./api", () => ({
  fetchHealth: vi.fn(async () => ({
    status: "ok",
    app: "Zonix API",
    version: "0.1.0",
    environment: "test",
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
        values: [
          "ns1.example.com hostmaster.example.com 1 3600 600 1209600 3600",
        ],
      },
      {
        zoneName: "example.com",
        name: "www",
        recordType: "A",
        ttl: 300,
        values: ["192.0.2.10"],
      },
    ],
  })),
}));

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

    expect(await screen.findByText("Configured backends")).toBeVisible();
    expect(
      (await screen.findAllByText("powerdns-sandbox")).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("Accessible zones")).toBeVisible();
    expect((await screen.findAllByText("example.com")).length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("Record sets")).toBeVisible();
    expect(await screen.findByText(/www A/i)).toBeVisible();
  });
});
