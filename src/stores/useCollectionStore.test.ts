// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { account, fetchAccountCollection, saveAccountCollection } = vi.hoisted(() => ({
  account: { id: "acct-1" as string | null },
  fetchAccountCollection: vi.fn(),
  saveAccountCollection: vi.fn(),
}));

vi.mock("@/api/hub", () => {
  class HubRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  return { fetchAccountCollection, HubRequestError, saveAccountCollection };
});
vi.mock("@/stores/useAuthStore", () => ({
  useAuthStore: {
    getState: () => ({ account: account.id ? { id: account.id } : null }),
  },
}));

import { HubRequestError } from "@/api/hub";

import { useCollectionStore } from "./useCollectionStore";

describe("collection account saves", () => {
  beforeEach(() => {
    localStorage.clear();
    account.id = "acct-1";
    fetchAccountCollection.mockReset();
    saveAccountCollection.mockReset();
    useCollectionStore.setState({
      accountId: "acct-1",
      version: 0,
      quantities: {},
      syncedQuantities: {},
      loading: false,
      error: null,
    });
  });

  it("rebases a local edit and retries after a version conflict", async () => {
    useCollectionStore.setState({
      version: 2,
      quantities: { "lightning bolt": 4 },
      syncedQuantities: { "lightning bolt": 4 },
    });
    saveAccountCollection
      .mockRejectedValueOnce(new HubRequestError(409, "conflict"))
      .mockResolvedValueOnce({
        version: 4,
        cards: [
          { cardKey: "lightning bolt", quantity: 4 },
          { cardKey: "counterspell", quantity: 2 },
          { cardKey: "sol ring", quantity: 1 },
        ],
      });
    fetchAccountCollection.mockResolvedValue({
      version: 3,
      cards: [
        { cardKey: "lightning bolt", quantity: 4 },
        { cardKey: "sol ring", quantity: 1 },
      ],
    });

    await useCollectionStore.getState().setQuantity("counterspell", 2);

    expect(saveAccountCollection).toHaveBeenNthCalledWith(2, {
      version: 3,
      cards: [
        { cardKey: "lightning bolt", quantity: 4 },
        { cardKey: "sol ring", quantity: 1 },
        { cardKey: "counterspell", quantity: 2 },
      ],
    });
    expect(useCollectionStore.getState()).toMatchObject({
      version: 4,
      quantities: { "lightning bolt": 4, "sol ring": 1, counterspell: 2 },
      syncedQuantities: { "lightning bolt": 4, "sol ring": 1, counterspell: 2 },
      error: null,
    });
  });

  it("retries a pending snapshot when initialization conflicts", async () => {
    localStorage.setItem(
      "manabrew-pending-account-collection",
      JSON.stringify({ accountId: "acct-1", quantities: { "lightning bolt": 3 } }),
    );
    fetchAccountCollection
      .mockResolvedValueOnce({
        version: 2,
        cards: [{ cardKey: "lightning bolt", quantity: 1 }],
      })
      .mockResolvedValueOnce({
        version: 3,
        cards: [
          { cardKey: "lightning bolt", quantity: 1 },
          { cardKey: "sol ring", quantity: 1 },
        ],
      });
    saveAccountCollection
      .mockRejectedValueOnce(new HubRequestError(409, "conflict"))
      .mockResolvedValueOnce({
        version: 4,
        cards: [{ cardKey: "lightning bolt", quantity: 3 }],
      });

    await useCollectionStore.getState().initialize("acct-1");

    expect(saveAccountCollection).toHaveBeenNthCalledWith(2, {
      version: 3,
      cards: [{ cardKey: "lightning bolt", quantity: 3 }],
    });
    expect(useCollectionStore.getState()).toMatchObject({
      version: 4,
      quantities: { "lightning bolt": 3 },
      syncedQuantities: { "lightning bolt": 3 },
      loading: false,
      error: null,
    });
    expect(localStorage.getItem("manabrew-pending-account-collection")).toBeNull();
  });

  it("reports a failed save and preserves the snapshot locally", async () => {
    saveAccountCollection.mockRejectedValue(new Error("offline"));

    await expect(useCollectionStore.getState().setQuantity("lightning bolt", 4)).rejects.toThrow(
      "offline",
    );

    expect(useCollectionStore.getState().accountId).toBe("acct-1");
    expect(useCollectionStore.getState().error).toBe("offline");
    expect(JSON.parse(localStorage.getItem("manabrew-pending-account-collection") ?? "{}")).toEqual(
      { accountId: "acct-1", quantities: { "lightning bolt": 4 } },
    );

    saveAccountCollection.mockResolvedValue({ version: 1, cards: [] });
    await useCollectionStore.getState().setQuantity("counterspell", 2);

    expect(useCollectionStore.getState().error).toBeNull();
    expect(localStorage.getItem("manabrew-pending-account-collection")).toBeNull();
  });

  it("rejects and preserves a queued snapshot when the account changes", async () => {
    let finishFirstSave: ((value: { version: number; cards: never[] }) => void) | undefined;
    saveAccountCollection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstSave = resolve;
        }),
    );

    const first = useCollectionStore.getState().setQuantity("lightning bolt", 4);
    await vi.waitFor(() => expect(saveAccountCollection).toHaveBeenCalledTimes(1));
    const second = useCollectionStore.getState().setQuantity("counterspell", 2);
    account.id = "acct-2";
    useCollectionStore.setState({ accountId: "acct-2", version: 0, quantities: {} });
    finishFirstSave?.({ version: 1, cards: [] });

    await first;
    await expect(second).rejects.toThrow("account changed");
    expect(JSON.parse(localStorage.getItem("manabrew-pending-account-collection") ?? "{}")).toEqual(
      {
        accountId: "acct-1",
        quantities: { "lightning bolt": 4, counterspell: 2 },
      },
    );
  });
});
