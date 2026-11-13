import { create } from "zustand";
import { forgeWasmGate } from "@/lib/forgeWasm";
import { getPlatform } from "@/platform";
import type {
  MatchFoundPayload,
  QueueBotFillOfferPayload,
  QueueBracketCount,
  QueuedDeck,
  QueueStatusPayload,
  QueueStepOfferPayload,
} from "@/types/server";

export type PodSize = 2 | 4;

interface StepOffer {
  down: number | null;
  up: number | null;
}

interface MatchmakingState {
  phase: "idle" | "queued" | "matched";
  podSize: PodSize;
  queuedAt: number | null;
  brackets: number[];
  waiting: QueueBracketCount[];
  offer: StepOffer | null;
  botFillOffer: number | null;
  botFill: boolean;
  match: MatchFoundPayload | null;
  enter(podSize: PodSize, decks: QueuedDeck[]): Promise<void>;
  acceptStep(bracket: number): Promise<void>;
  dismissOffer(): void;
  acceptBotFill(): Promise<void>;
  dismissBotFill(): void;
  leave(): Promise<void>;
  clearMatch(): void;
}

let unsubscribers: Array<() => void> = [];

function listen(set: (partial: Partial<MatchmakingState>) => void) {
  if (unsubscribers.length) return;
  const events = getPlatform().events;
  unsubscribers = [
    events.on<QueueStatusPayload>("server:queue_status", (payload) => {
      if (!payload.queued) {
        set({
          phase: "idle",
          queuedAt: null,
          brackets: [],
          waiting: [],
          offer: null,
          botFillOffer: null,
          botFill: false,
        });
        return;
      }
      set({ brackets: payload.brackets, waiting: payload.waiting });
    }),
    events.on<QueueStepOfferPayload>("server:queue_step_offer", (payload) => {
      set({
        offer: { down: payload.down ?? null, up: payload.up ?? null },
        waiting: payload.waiting,
      });
    }),
    events.on<QueueBotFillOfferPayload>("server:queue_bot_fill_offer", (payload) => {
      set({ botFillOffer: payload.players });
    }),
    events.on<MatchFoundPayload>("server:match_found", (payload) => {
      set({ phase: "matched", match: payload, offer: null, botFillOffer: null, queuedAt: null });
    }),
    events.on("server:disconnected", () => {
      set({ phase: "idle", queuedAt: null, offer: null, botFillOffer: null, botFill: false });
    }),
  ];
}

export const useMatchmakingStore = create<MatchmakingState>((set) => ({
  phase: "idle",
  podSize: 4,
  queuedAt: null,
  brackets: [],
  waiting: [],
  offer: null,
  botFillOffer: null,
  botFill: false,
  match: null,
  async enter(podSize, decks) {
    const server = getPlatform().server;
    if (!server) throw new Error("Multiplayer is not available.");
    listen(set);
    set({
      phase: "queued",
      podSize,
      queuedAt: Date.now(),
      brackets: [...new Set(decks.map((deck) => deck.bracket))],
      waiting: [],
      offer: null,
      botFillOffer: null,
      botFill: false,
      match: null,
    });
    await server.enterQueue({
      format: "Commander",
      podSize,
      decks,
      canHost: forgeWasmGate() === "in_browser",
    });
  },
  async acceptStep(bracket) {
    set({ offer: null });
    await getPlatform().server?.acceptQueueStep(bracket);
  },
  dismissOffer() {
    set({ offer: null });
  },
  async acceptBotFill() {
    set({ botFillOffer: null, botFill: true });
    await getPlatform().server?.acceptBotFill();
  },
  dismissBotFill() {
    set({ botFillOffer: null });
  },
  async leave() {
    set({ phase: "idle", queuedAt: null, offer: null, botFillOffer: null, botFill: false });
    await getPlatform().server?.leaveQueue();
  },
  clearMatch() {
    set({ phase: "idle", match: null });
  },
}));
