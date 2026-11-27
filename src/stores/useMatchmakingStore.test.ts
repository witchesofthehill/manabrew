import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";
import type { QueuedDeck } from "@/types/server";

const fixture = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown) => void>(),
  busy: false,
  room: null as unknown,
  prepare: vi.fn(),
  server: {
    enterQueue: vi.fn(),
    leaveQueue: vi.fn(),
    acceptMatch: vi.fn(),
    declineMatch: vi.fn(),
    answerTableCall: vi.fn(),
    acceptQueueStep: vi.fn(),
    setQueueSteps: vi.fn(),
    acceptBotFill: vi.fn(),
  },
}));
vi.mock("@/platform", () => ({
  getPlatform: () => ({
    server: fixture.server,
    events: {
      on: (name: string, listener: (payload: unknown) => void) => {
        fixture.listeners.set(name, listener);
        return () => fixture.listeners.delete(name);
      },
    },
  }),
}));
vi.mock("@/lib/forgeWasm", () => ({ forgeWasmGate: () => "in_browser" }));
vi.mock("@/lib/localGamePresence", () => ({
  localGameActive: () => fixture.busy,
}));
vi.mock("@/lib/soundRuntime", () => ({ playSound: vi.fn() }));
vi.mock("@/stores/useServerStore", () => ({
  useServerStore: { getState: () => ({ currentRoom: fixture.room }) },
}));
vi.mock("@/lib/brackets", () => ({ assessBracket: vi.fn() }));
vi.mock("@/lib/gameChangers", () => ({ fetchGameChangers: vi.fn() }));
vi.mock("@/api/commanderSpellbook", () => ({ findMyCombos: vi.fn() }));
vi.mock("@/api/edhrec", () => ({ fetchComboVotes: vi.fn() }));
vi.mock("@/lib/queueDecks", async (original) => ({
  ...(await original<typeof import("@/lib/queueDecks")>()),
  commanderQueueDecks: fixture.prepare,
}));
import { useMatchmakingStore } from "./useMatchmakingStore";
import { queueDeckChoices } from "@/lib/queueDecks";
import { playSound } from "@/lib/soundRuntime";

const deck = (name: string, bracket = 3): QueuedDeck => ({
  deck_name: name,
  bracket,
  deck: { name, format: "commander", cards: [], sideboard: [] } as Deck,
});
const emit = (name: string, payload: unknown) => fixture.listeners.get(`server:${name}`)?.(payload);
const proposal = () =>
  emit("match_proposal", { bracket: 3, pod_size: 4, players: 4, busy: 0, expires_s: 30 });
async function enter(decks = [deck("A")]) {
  fixture.prepare.mockResolvedValueOnce(decks);
  await useMatchmakingStore.getState().enter(
    [4, 3],
    decks.map((entry) => entry.deck),
  );
  emit("queue_status", { queued: true, brackets: [3], waiting: [] });
}

beforeEach(async () => {
  await useMatchmakingStore.getState().leave();
  vi.clearAllMocks();
  fixture.busy = false;
  fixture.room = null;
});

describe("Commander matchmaking lifecycle", () => {
  it("allows Manabot fill right after queueing when the player chose it", async () => {
    fixture.prepare.mockResolvedValueOnce([deck("A")]);
    await useMatchmakingStore.getState().enter([4, 3], [deck("A").deck], true);
    expect(fixture.server.enterQueue).toHaveBeenCalledOnce();
    expect(fixture.server.acceptBotFill).toHaveBeenCalledOnce();
    expect(fixture.server.enterQueue.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.server.acceptBotFill.mock.invocationCallOrder[0],
    );
    expect(useMatchmakingStore.getState().botFill).toBe(true);
  });
  it("does not allow Manabot fill unless the player chose it", async () => {
    await enter();
    expect(fixture.server.acceptBotFill).not.toHaveBeenCalled();
    expect(useMatchmakingStore.getState().botFill).toBe(false);
  });
  it("plays the match-found sound when a match is ready during solo play", async () => {
    fixture.busy = true;
    await enter();
    proposal();
    expect(playSound).toHaveBeenCalledExactlyOnceWith("matchFound");
  });
  it("plays the match-found sound for an open table while browsing", async () => {
    await enter();
    emit("table_call", {
      room_id: "table",
      host: "Sam",
      bracket: 3,
      pod_size: 4,
      seats: 1,
      expires_s: 30,
    });
    expect(playSound).toHaveBeenCalledExactlyOnceWith("matchFound");
  });
  it("waits for an explicit accept with a single eligible deck while browsing", async () => {
    await enter([deck("Wrong", 5), deck("Exact")]);
    proposal();
    expect(fixture.server.acceptMatch).not.toHaveBeenCalled();
    expect(useMatchmakingStore.getState().accepted).toBe(false);
    await useMatchmakingStore.getState().acceptMatch(1);
    expect(fixture.server.acceptMatch).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("waits for an explicit choice when duplicate deck names fit", async () => {
    await enter([deck("Same"), deck("Same"), deck("Wrong", 5)]);
    proposal();
    expect(fixture.server.acceptMatch).not.toHaveBeenCalled();
    await useMatchmakingStore.getState().acceptMatch(2);
    expect(fixture.server.acceptMatch).not.toHaveBeenCalled();
    await useMatchmakingStore.getState().acceptMatch(1);
    expect(fixture.server.acceptMatch).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("does not accept an expired proposal", async () => {
    await enter();
    proposal();
    useMatchmakingStore.setState({ proposalExpiresAt: Date.now() - 1 });
    await useMatchmakingStore.getState().acceptMatch(0);
    expect(fixture.server.acceptMatch).not.toHaveBeenCalled();
  });
  it("cancels bracket preparation without entering the queue later", async () => {
    let resolve!: (value: QueuedDeck[]) => void;
    fixture.prepare.mockReturnValueOnce(
      new Promise<QueuedDeck[]>((done) => {
        resolve = done;
      }),
    );
    const preparing = useMatchmakingStore.getState().enter([4], [deck("A").deck]);
    expect(useMatchmakingStore.getState().phase).toBe("preparing");
    await useMatchmakingStore.getState().leave();
    resolve([deck("A")]);
    await preparing;
    expect(fixture.server.enterQueue).not.toHaveBeenCalled();
    expect(useMatchmakingStore.getState().phase).toBe("idle");
  });
  it("does not queue if a room was joined during preparation", async () => {
    fixture.prepare.mockImplementationOnce(async () => {
      fixture.room = {};
      return [deck("A")];
    });
    await useMatchmakingStore.getState().enter([4], [deck("A").deck]);
    expect(fixture.server.enterQueue).not.toHaveBeenCalled();
    expect(useMatchmakingStore.getState().phase).toBe("idle");
  });
  it("keeps searching after declining a table invitation", async () => {
    await enter();
    emit("table_call", {
      room_id: "table",
      host: "Sam",
      bracket: 3,
      pod_size: 4,
      seats: 1,
      expires_s: 30,
    });
    await useMatchmakingStore.getState().answerTableCall(false);
    expect(fixture.server.answerTableCall).toHaveBeenCalledWith("table", false, undefined);
    expect(useMatchmakingStore.getState()).toMatchObject({ phase: "queued", tableCall: null });
  });
  it("sends the chosen deck index when accepting a table invitation", async () => {
    await enter([deck("Same"), deck("Same")]);
    emit("table_call", {
      room_id: "table",
      host: "Sam",
      bracket: 3,
      pod_size: 4,
      seats: 1,
      expires_s: 30,
    });
    await useMatchmakingStore.getState().answerTableCall(true, 1);
    expect(fixture.server.answerTableCall).toHaveBeenCalledWith("table", true, 1);
    expect(useMatchmakingStore.getState().phase).toBe("joining");
  });
  it("clears search state after disconnect", async () => {
    await enter();
    proposal();
    emit("disconnected", {});
    expect(useMatchmakingStore.getState()).toMatchObject({
      phase: "idle",
      proposal: null,
      queuedDecks: [],
    });
  });
  it("keeps a completed match when a delayed queue status arrives", async () => {
    await enter();
    emit("match_found", { room: { room_id: "table" }, bracket: 3, host: "Sam", deck_name: "A" });
    emit("queue_status", { queued: false, brackets: [], waiting: [] });
    expect(useMatchmakingStore.getState().phase).toBe("matched");
  });
});

describe("eligible queue decks", () => {
  it("prefers exact brackets and preserves original indices", () => {
    expect(
      queueDeckChoices([deck("A", 2), deck("B", 3), deck("C", 3), deck("D", 4)], 3).map(
        (choice) => choice.index,
      ),
    ).toEqual([1, 2]);
  });
  it("offers equally close decks after bracket expansion", () => {
    expect(
      queueDeckChoices([deck("A", 2), deck("B", 4), deck("C", 5)], 3).map((choice) => choice.index),
    ).toEqual([0, 1]);
  });
});
