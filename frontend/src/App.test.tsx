import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { App } from "./App";

vi.mock("./api", () => ({
  fetchHealth: vi.fn(async () => ({
    status: "ok",
    app: "Zonix API",
    version: "0.1.0",
    environment: "test",
  })),
}));

describe("App", () => {
  it("renders the frontend shell and backend health summary", async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: /operate dns without tab-hopping/i })).toBeVisible();
    expect(await screen.findByText("Zonix API")).toBeVisible();
    expect(screen.getByText("Capability matrix")).toBeVisible();
  });
});
