// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { account, saveAccountCollection } = vi.hoisted(() => ({
  account: { id: "acct-1" as string | null },
  saveAccountCollection: vi.fn(),
}));

vi.mock("@/api/hub", () => ({
  fetchAccountCollection: vi.fn(),
  saveAccountCollection,
}));
vi.mock("@/stores/useAuthStore", () => ({
  useAuthStore: {
    getState: () => ({ account: account.id ? { id: account.id } : null }),
  },
}));

import { useCollectionStore } from "./useCollectionStore";

describe("collection account saves", () => {
  beforeEach(() => {
    localStorage.clear();
    account.id = "acct-1";
    saveAccountCollection.mockReset();
    useCollectionStore.setState({
      accountId: "acct-1",
      version: 0,
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
    expect(JSON.parse(localStorage.getItem("manabrew-pending-account-collection") ?? "{}")).toEqual(
      { accountId: "acct-1", quantities: { "lightning bolt": 4 } },
    );
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
