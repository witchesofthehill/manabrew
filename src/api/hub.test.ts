import { beforeEach, describe, expect, it, vi } from "vitest";

const platformFetch = vi.hoisted(() => vi.fn());

vi.mock("@/config/webRuntimeConfig", () => ({ getHubApiUrl: () => "https://hub.test" }));
vi.mock("@/featureFlags", () => ({ isFeatureEnabled: () => false }));
vi.mock("@/lib/platformFetch", () => ({ platformFetch }));
vi.mock("@/stores/useAuthStore", () => ({
  getAccessToken: vi.fn().mockResolvedValue(null),
  useAuthStore: {
    getState: () => ({ token: null }),
    setState: vi.fn(),
  },
}));

import { verifyCardPrintings } from "./hub";

describe("card printing verification", () => {
  beforeEach(() => platformFetch.mockReset());

  it("verifies large collections in bounded batches and reports each completed batch", async () => {
    platformFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ matched: Array.from({ length: 5_000 }, () => true) })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ matched: [false] })));
    const onBatch = vi.fn();
    const identifiers = Array.from({ length: 5_001 }, (_, index) => ({
      name: `Card ${index}`,
      setCode: "tst",
      collectorNumber: String(index),
    }));

    const response = await verifyCardPrintings({ identifiers }, onBatch);

    expect(platformFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(platformFetch.mock.calls[0][1].body as string).identifiers).toHaveLength(
      5_000,
    );
    expect(JSON.parse(platformFetch.mock.calls[1][1].body as string).identifiers).toHaveLength(1);
    expect(onBatch).toHaveBeenNthCalledWith(1, expect.any(Array), 0, 5_001);
    expect(onBatch).toHaveBeenNthCalledWith(2, [false], 5_000, 5_001);
    expect(response.matched).toHaveLength(5_001);
    expect(response.matched.at(-1)).toBe(false);
  });

  it("rejects incomplete verification responses before reporting the batch", async () => {
    platformFetch.mockResolvedValueOnce(new Response(JSON.stringify({ matched: [true] })));
    const onBatch = vi.fn();

    await expect(
      verifyCardPrintings(
        {
          identifiers: [
            { name: "One", setCode: "tst", collectorNumber: "1" },
            { name: "Two", setCode: "tst", collectorNumber: "2" },
          ],
        },
        onBatch,
      ),
    ).rejects.toThrow("incomplete response");
    expect(onBatch).not.toHaveBeenCalled();
  });

  it("reports completed batches before a later request fails", async () => {
    platformFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ matched: Array.from({ length: 5_000 }, () => true) })),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    const onBatch = vi.fn();
    const identifiers = Array.from({ length: 5_001 }, (_, index) => ({
      name: `Card ${index}`,
      setCode: "tst",
      collectorNumber: String(index),
    }));

    await expect(verifyCardPrintings({ identifiers }, onBatch)).rejects.toThrow("Unavailable");
    expect(onBatch).toHaveBeenCalledTimes(1);
    expect(onBatch).toHaveBeenCalledWith(expect.any(Array), 0, 5_001);
  });
});
