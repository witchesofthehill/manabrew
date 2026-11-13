import { create } from "zustand";
import { forgeWasmGate } from "@/lib/forgeWasm";
import { localGameActive } from "@/lib/localGamePresence";
import { getPlatform } from "@/platform";
import type {
  MatchFoundPayload,
  MatchProposalPayload,
  QueueBotFillOfferPayload,
  QueueBracketCount,
  QueuedDeck,
  QueueStatusPayload,
  QueueStepOfferPayload,
} from "@/types/server";

export type PodSize = 2 | 3 | 4;

export const POD_SIZES: PodSize[] = [4, 3, 2];

export function tableLabel(size: number): string {
  return size === 2 ? "1v1" : `${size}-player pod`;
}

interface StepOffer {
  down: number | null;
  up: number | null;
}

interface MatchmakingState {
  phase: "idle" | "queued" | "proposed" | "matched";
  podSizes: PodSize[];
  queuedAt: number | null;
  brackets: number[];
  waiting: QueueBracketCount[];
  offer: StepOffer | null;
  botFillOffer: number | null;
  botFill: boolean;
  proposal: MatchProposalPayload | null;
  match: MatchFoundPayload | null;
  enter(podSizes: PodSize[], decks: QueuedDeck[]): Promise<void>;
  acceptStep(bracket: number): Promise<void>;
  dismissOffer(): void;
  acceptBotFill(): Promise<void>;
  dismissBotFill(): void;
  acceptMatch(): Promise<void>;
  declineMatch(): Promise<void>;
  leave(): Promise<void>;
  clearMatch(): void;
}

const IDLE: Pick<
  MatchmakingState,
  "phase" | "queuedAt" | "brackets" | "waiting" | "offer" | "botFillOffer" | "botFill" | "proposal"
> = {
  phase: "idle",
  queuedAt: null,
  brackets: [],
  waiting: [],
  offer: null,
  botFillOffer: null,
  botFill: false,
  proposal: null,
};

let unsubscribers: Array<() => void> = [];

function listen(set: (partial: Partial<MatchmakingState>) => void, get: () => MatchmakingState) {
  if (unsubscribers.length) return;
  const events = getPlatform().events;
  unsubscribers = [
    events.on<QueueStatusPayload>("server:queue_status", (payload) => {
      if (!payload.queued) {
        if (get().phase !== "matched") set({ ...IDLE });
        return;
      }
      set({
        brackets: payload.brackets,
        waiting: payload.waiting,
        ...(get().phase === "proposed" ? { phase: "queued", proposal: null } : {}),
      });
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
    events.on<MatchProposalPayload>("server:match_proposal", (payload) => {
      set({ phase: "proposed", proposal: payload, offer: null, botFillOffer: null });
      if (!localGameActive()) void get().acceptMatch();
    }),
    events.on<MatchFoundPayload>("server:match_found", (payload) => {
      set({ ...IDLE, phase: "matched", match: payload });
    }),
    events.on("server:disconnected", () => {
      set({ ...IDLE });
    }),
  ];
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  ...IDLE,
  podSizes: [4],
  match: null,
  async enter(podSizes, decks) {
    const server = getPlatform().server;
    if (!server) throw new Error("Multiplayer is not available.");
    listen(set, get);
    set({
      ...IDLE,
      phase: "queued",
      podSizes,
      queuedAt: Date.now(),
      brackets: [...new Set(decks.map((deck) => deck.bracket))],
      match: null,
    });
    await server.enterQueue({
      format: "Commander",
      podSizes,
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
  async acceptMatch() {
    await getPlatform().server?.acceptMatch();
  },
  async declineMatch() {
    set({ ...IDLE });
    await getPlatform().server?.declineMatch();
  },
  async leave() {
    set({ ...IDLE });
    await getPlatform().server?.leaveQueue();
  },
  clearMatch() {
    set({ phase: "idle", match: null });
  },
}));
