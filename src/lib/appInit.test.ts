import { beforeEach, describe, expect, it, vi } from "vitest";

const { prefetchCards, prefetchPresetDecks, postInitStage } = vi.hoisted(() => ({
  prefetchCards: vi.fn<() => Promise<void>>(),
  prefetchPresetDecks: vi.fn<() => Promise<void>>(),
  postInitStage: vi.fn<(stage: string) => void>(),
}));

vi.mock("@/stores/useScryfallStore", () => ({
  prefetchCards,
  prefetchTokenArchive: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  useScryfallStore: {
    getState: () => ({ fetchSets: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]) }),
    setState: vi.fn(),
  },
}));
vi.mock("@/stores/useDeckStore", () => ({
  useDeckStore: { getState: () => ({ savedDecks: [], currentDeck: undefined }) },
}));
vi.mock("@/components/deck/deckCover.utils", () => ({ resolveCoverCard: () => undefined }));
vi.mock("@/stores/usePresetDecksStore", () => ({
  prefetchPresetDecks,
  usePresetDecksStore: { getState: () => ({ decks: [] }) },
}));
vi.mock("@/stores/useForgeRoomAvailabilityStore", () => ({
  initializeForgeRoomAvailability: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock("@/platform", () => ({
  getEventBus: () => ({ emit: (_event: string, payload: { stage: string }) => postInitStage(payload.stage) }),
  getPlatform: () => ({ init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
}));

async function loadInitApp() {
  vi.resetModules();
  return (await import("./appInit")).initApp;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("app initialization readiness", () => {
  beforeEach(() => {
    prefetchCards.mockReset();
    prefetchPresetDecks.mockReset().mockResolvedValue(undefined);
    postInitStage.mockReset();
  });

  it("releases the ready gate while optional deck-cover prefetch is still pending", async () => {
    const coverPrefetch = deferred();
    prefetchCards.mockReturnValue(coverPrefetch.promise);
    const initApp = await loadInitApp();

    const init = initApp();
    await vi.waitFor(() => expect(prefetchCards).toHaveBeenCalledOnce());

    try {
      expect(postInitStage).toHaveBeenCalledWith("ready");
    } finally {
      coverPrefetch.resolve();
    }
    await init;
  });
});
