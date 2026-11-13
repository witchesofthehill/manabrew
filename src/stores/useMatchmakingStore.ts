import { toast } from "sonner";
import { create } from "zustand";
import { ownedDecksNow } from "@/hooks/useOwnedDecks";
import { forgeWasmGate } from "@/lib/forgeWasm";
import { localGameActive, onLocalGameEnd } from "@/lib/localGamePresence";
import { commanderQueueDecks } from "@/lib/queueDecks";
import { getPlatform } from "@/platform";
import type { Deck } from "@/protocol/deck";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import {
  RELAY_FEATURE,
  type MatchFoundPayload,
  type MatchProposalPayload,
  type QueueBotFillOfferPayload,
  type QueueBracketCount,
  type QueuedDeck,
  type QueueStatusPayload,
  type QueueStepOfferPayload,
} from "@/types/server";

export type PodSize = 2 | 3 | 4;

export const POD_SIZES: PodSize[] = [4, 3, 2];

export function tableLabel(size: number): string {
  return size === 2 ? "1v1" : `${size}-player pod`;
}

export function podSizesFor(size: PodSize, otherPodSize: boolean): PodSize[] {
  if (size === 2 || !otherPodSize) return [size];
  return [size, size === 4 ? 3 : 4];
}

const RELAY_WAIT_MS = 10_000;
const ASK_TO_QUEUE_MS = 20_000;
const MAX_QUEUED_DECKS = 32;

function deckKey(deck: Deck): string {
  return `${deck.name}|${deck.commanders?.map((card) => card.identity.name).join("+") ?? ""}`;
}

interface StepOffer {
  down: number | null;
  up: number | null;
}

interface MatchmakingState {
  phase: "idle" | "queued" | "proposed" | "matched";
  podSizes: PodSize[];
  auto: boolean;
  queuedAt: number | null;
  brackets: number[];
  waiting: QueueBracketCount[];
  offer: StepOffer | null;
  botFillOffer: number | null;
  botFill: boolean;
  proposal: MatchProposalPayload | null;
  accepted: boolean;
  match: MatchFoundPayload | null;
  enter(podSizes: PodSize[], decks: QueuedDeck[], auto?: boolean): Promise<void>;
  autoEnter(deck: Deck, seats: number): Promise<void>;
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
  | "phase"
  | "auto"
  | "queuedAt"
  | "brackets"
  | "waiting"
  | "offer"
  | "botFillOffer"
  | "botFill"
  | "proposal"
  | "accepted"
> = {
  phase: "idle",
  auto: false,
  queuedAt: null,
  brackets: [],
  waiting: [],
  offer: null,
  botFillOffer: null,
  botFill: false,
  proposal: null,
  accepted: false,
};

function relayReady(): boolean {
  const server = useServerStore.getState();
  return server.connected && server.hasRelayFeature(RELAY_FEATURE.Matchmaking);
}

function waitForRelay(): Promise<boolean> {
  if (relayReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, RELAY_WAIT_MS);
    const unsubscribe = useServerStore.subscribe(() => {
      if (!relayReady()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(true);
    });
  });
}

function askToQueue(): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: boolean | null) => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };
    toast("Look for human players while you play?", {
      description:
        "We queue your Commander decks. When a table is found you get 30 seconds to join, which ends this game. You can change this on the Play page.",
      duration: ASK_TO_QUEUE_MS,
      action: { label: "Yes", onClick: () => settle(true) },
      cancel: { label: "No thanks", onClick: () => settle(false) },
      onDismiss: () => settle(null),
      onAutoClose: () => settle(null),
    });
  });
}

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
        ...(get().phase === "proposed" ? { phase: "queued", proposal: null, accepted: false } : {}),
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
      set({
        phase: "proposed",
        proposal: payload,
        accepted: false,
        offer: null,
        botFillOffer: null,
      });
      if (!localGameActive()) void get().acceptMatch();
    }),
    events.on<MatchFoundPayload>("server:match_found", (payload) => {
      set({ ...IDLE, phase: "matched", match: payload });
    }),
    events.on("server:disconnected", () => {
      set({ ...IDLE });
    }),
    onLocalGameEnd(() => {
      if (get().phase === "proposed" && !get().accepted) void get().acceptMatch();
    }),
  ];
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  ...IDLE,
  podSizes: [4],
  match: null,
  async enter(podSizes, decks, auto = false) {
    const server = getPlatform().server;
    if (!server) throw new Error("Multiplayer is not available.");
    listen(set, get);
    set({
      ...IDLE,
      phase: "queued",
      auto,
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
  async autoEnter(deck, seats) {
    const preferences = usePreferencesStore.getState();
    if (preferences.openToHumanMatches === false || get().phase !== "idle") return;
    if (seats < 2 || seats > 4) return;
    if (deck.format !== "commander" || !deck.commanders?.length) return;
    if (!(await waitForRelay())) return;
    if (preferences.openToHumanMatches === null) {
      const answer = await askToQueue();
      if (answer === null) return;
      usePreferencesStore.getState().setOpenToHumanMatches(answer);
      if (!answer) return;
    }
    const seen = new Set<string>();
    const decks = [deck, ...ownedDecksNow().map((owned) => owned.deck)].filter((candidate) => {
      const key = deckKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const queued = (await commanderQueueDecks(decks)).slice(0, MAX_QUEUED_DECKS);
    if (queued.length === 0 || !relayReady() || get().phase !== "idle") return;
    await get().enter(podSizesFor(seats as PodSize, true), queued, true);
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
    set({ accepted: true });
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
