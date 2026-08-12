// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveAccountCollection } = vi.hoisted(() => ({ saveAccountCollection: vi.fn() }));

vi.mock("@/api/hub", () => ({
  fetchAccountCollection: vi.fn(),
  saveAccountCollection,
}));
vi.mock("@/stores/useAuthStore", () => ({
  useAuthStore: {
    getState: () => ({ account: { id: "acct-1" } }),
  },
}));

import { useCollectionStore } from "./useCollectionStore";

describe("collection account saves", () => {
  beforeEach(() => {
    localStorage.clear();
    saveAccountCollection.mockReset();
    useCollectionStore.setState({
      accountId: "acct-1",
      quantities: {},
      loading: false,
      error: null,
    });
  });

  it("reports a failed save and preserves the snapshot locally", async () => {
    saveAccountCollection.mockRejectedValue(new Error("offline"));

    await expect(useCollectionStore.getState().setQuantity("lightning bolt", 4)).rejects.toThrow(
      "offline",
    );

    expect(useCollectionStore.getState().accountId).toBe("acct-1");
    expect(useCollectionStore.getState().error).toBe("offline");
    expect(JSON.parse(localStorage.getItem("manabrew-card-collection") ?? "{}")).toEqual({
      "lightning bolt": 4,
    });
  });
});
