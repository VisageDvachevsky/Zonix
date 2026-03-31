import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDelete = vi.fn();

vi.mock("./generated/client", () => ({
  createGeneratedApiClient: vi.fn(() => ({
    DELETE: mockDelete,
  })),
}));

describe("deleteZoneRecord", () => {
  beforeEach(() => {
    mockDelete.mockReset();
  });

  it("treats 204 no-content responses as a successful delete", async () => {
    mockDelete.mockResolvedValueOnce({
      data: undefined,
      error: undefined,
      response: new Response(null, { status: 204 }),
    });

    const { deleteZoneRecord } = await import("./api");

    await expect(
      deleteZoneRecord({
        zoneName: "example.com",
        name: "pw-e2e",
        recordType: "A",
        expectedVersion: "version-1",
      }),
    ).resolves.toBeUndefined();

    expect(mockDelete).toHaveBeenCalledWith("/zones/{zone_name}/records", {
      params: { path: { zone_name: "example.com" } },
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: {
        zoneName: "example.com",
        name: "pw-e2e",
        recordType: "A",
        expectedVersion: "version-1",
      },
    });
  });
});
