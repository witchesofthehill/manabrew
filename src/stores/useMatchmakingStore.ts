import { create } from "zustand";
import { toast } from "sonner";
import { forgeWasmGate } from "@/lib/forgeWasm";
import { localGameActive, onLocalGameEnd } from "@/lib/localGamePresence";
import { playSound } from "@/lib/soundRuntime";
import { commanderQueueDecks, queueDeckChoices } from "@/lib/queueDecks";
import { stripUsernameTag } from "@/lib/username";
import type { Deck } from "@/protocol/deck";
import { useServerStore } from "@/stores/useServerStore";
import { getPlatform } from "@/platform";
import type {
  MatchFoundPayload,
  MatchProposalAcceptsPayload,
  MatchProposalPayload,
  QueueBotFillOfferPayload,
  QueueBracketCount,
  QueueStatusPayload,
  QueuedDeck,
  QueueStepOfferPayload,
  TableCallPayload,
  ServerErrorPayload,
} from "@/types/server";
import { RELAY_FEATURE } from "@/types/server";

export type PodSize = 2 | 3 | 4;

export const POD_SIZES: PodSize[] = [4, 3, 2];

export function tableLabel(size: number): string {
  return size === 2 ? "1v1" : `${size}-player pod`;
}

function requestCallNotifications(): void {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
}

function notifyMatch(title: string, body: string, expires: number): void {
  playSound("matchFound");
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!document.hidden) return;
  try {
    const notification = new Notification(title, { body, tag: "commander-match" });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    setTimeout(() => notification.close(), expires * 1000);
  } catch {
    return;
  }
}

interface StepOffer {
  down: number | null;
  up: number | null;
}

interface MatchmakingState {
  phase: "idle" | "preparing" | "queued" | "proposed" | "joining" | "matched";
  podSizes: PodSize[];
  queuedAt: number | null;
  queueConfirmed: boolean;
  brackets: number[];
  waiting: QueueBracketCount[];
  offer: StepOffer | null;
  botFillOffer: number | null;
  botFill: boolean;
  proposal: MatchProposalPayload | null;
  proposalAccepts: number;
  accepted: boolean;
  proposalExpiresAt: number | null;
  tableCallExpiresAt: number | null;
  deckNames: string[];
  queuedDecks: QueuedDeck[];
  match: MatchFoundPayload | null;
  tableCall: TableCallPayload | null;
  answerTableCall(join: boolean, deckIndex?: number): Promise<void>;
  enter(podSizes: PodSize[], decks: Deck[]): Promise<void>;
  setSteps(steps: number[]): Promise<void>;
  dismissOffer(): void;
  acceptBotFill(): Promise<void>;
  dismissBotFill(): void;
  acceptMatch(deckIndex?: number): Promise<void>;
  declineMatch(): Promise<void>;
  leave(): Promise<void>;
  clearMatch(): void;
}

const IDLE: Pick<
  MatchmakingState,
  | "phase"
  | "queuedAt"
  | "queueConfirmed"
  | "brackets"
  | "waiting"
  | "offer"
  | "botFillOffer"
  | "botFill"
  | "proposal"
  | "proposalAccepts"
  | "accepted"
  | "proposalExpiresAt"
  | "tableCallExpiresAt"
  | "tableCall"
  | "deckNames"
  | "queuedDecks"
> = {
  phase: "idle",
  queuedAt: null,
  queueConfirmed: false,
  brackets: [],
  waiting: [],
  offer: null,
  botFillOffer: null,
  botFill: false,
  proposal: null,
  proposalAccepts: 0,
  accepted: false,
  proposalExpiresAt: null,
  tableCallExpiresAt: null,
  tableCall: null,
  deckNames: [],
  queuedDecks: [],
};

let preparation = 0;
let unsubscribers: Array<() => void> = [];

function listen(set: (partial: Partial<MatchmakingState>) => void, get: () => MatchmakingState) {
  if (unsubscribers.length) return;
  const events = getPlatform().events;
  unsubscribers = [
    events.on<QueueStatusPayload>("server:queue_status", (payload) => {
      if (get().phase === "preparing") return;
      if (!payload.queued) {
        if (get().phase !== "matched") set({ ...IDLE });
        return;
      }
      if (get().phase === "idle" || get().phase === "matched") return;
      set({
        phase: "queued",
        queueConfirmed: true,
        brackets: payload.brackets,
        waiting: payload.waiting,
        proposal: null,
        proposalExpiresAt: null,
        ...(get().phase === "joining" ? { tableCall: null, tableCallExpiresAt: null } : {}),
        accepted: false,
      });
    }),
    events.on<QueueStepOfferPayload>("server:queue_step_offer", (payload) => {
      if (get().phase !== "queued") return;
      set({
        offer: { down: payload.down ?? null, up: payload.up ?? null },
        waiting: payload.waiting,
      });
    }),
    events.on<QueueBotFillOfferPayload>("server:queue_bot_fill_offer", (payload) => {
      if (get().phase === "queued") set({ botFillOffer: payload.players });
    }),
    events.on<MatchProposalPayload>("server:match_proposal", (payload) => {
      if (get().phase !== "queued") return;
      set({
        phase: "proposed",
        proposal: payload,
        proposalAccepts: 0,
        proposalExpiresAt: Date.now() + payload.expires_s * 1000,
        tableCall: null,
        tableCallExpiresAt: null,
        accepted: false,
        offer: null,
        botFillOffer: null,
      });
      notifyMatch(
        "Your Commander table is ready",
        `Bracket ${payload.bracket} · ${tableLabel(payload.pod_size)}${localGameActive() ? ". Return to Manabrew to join." : ""}`,
        payload.expires_s,
      );
      if (!localGameActive())
        void get()
          .acceptMatch()
          .catch(() => undefined);
    }),
    events.on<MatchProposalAcceptsPayload>("server:match_proposal_accepts", (payload) => {
      if (get().phase === "proposed") set({ proposalAccepts: payload.accepted });
    }),
    events.on<TableCallPayload>("server:table_call", (payload) => {
      if (get().phase !== "queued") return;
      set({ tableCall: payload, tableCallExpiresAt: Date.now() + payload.expires_s * 1000 });
      notifyMatch(
        `${stripUsernameTag(payload.host)} has a seat for you`,
        `Bracket ${payload.bracket} · ${tableLabel(payload.pod_size)}`,
        payload.expires_s,
      );
    }),
    events.on<MatchFoundPayload>("server:match_found", (payload) => {
      set({ ...IDLE, phase: "matched", match: payload, tableCall: null });
    }),
    events.on<ServerErrorPayload>("server:error", (payload) => {
      if (payload.code !== "invalid_queue") return;
      if (get().phase === "proposed") set({ accepted: false });
      else if (get().phase === "joining") set({ phase: "queued" });
      else if (!get().queueConfirmed) set({ ...IDLE });
    }),
    events.on("server:disconnected", () => {
      if (get().phase !== "idle" && get().phase !== "matched") {
        toast.info("Search stopped: connection lost.", {
          description: "Find a game again once you’re reconnected.",
        });
      }
      preparation++;
      set({ ...IDLE, tableCall: null });
    }),
    onLocalGameEnd(() => {
      if (get().phase === "proposed" && !get().accepted) {
        void get()
          .acceptMatch()
          .catch(() => undefined);
      }
    }),
  ];
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  ...IDLE,
  podSizes: [4],
  match: null,
  tableCall: null,
  async answerTableCall(join, deckIndex) {
    const { tableCall: call, tableCallExpiresAt } = get();
    if (!call || !tableCallExpiresAt || Date.now() >= tableCallExpiresAt) return;
    if (join) set({ phase: "joining" });
    try {
      await getPlatform().server?.answerTableCall(call.room_id, join, deckIndex);
      if (!join && get().tableCall === call) set({ tableCall: null, tableCallExpiresAt: null });
    } catch (error) {
      if (get().tableCall === call) set({ phase: "queued" });
      throw error;
    }
  },
  async enter(podSizes, decks) {
    if (get().phase !== "idle") return;
    const server = getPlatform().server;
    if (!server) throw new Error("Multiplayer is not available.");
    listen(set, get);
    requestCallNotifications();
    const request = ++preparation;
    set({
      ...IDLE,
      phase: "preparing",
      podSizes,
      deckNames: decks.map((deck) => deck.name),
      match: null,
    });
    try {
      const queuedDecks = await commanderQueueDecks(decks);
      if (request !== preparation || get().phase !== "preparing") return;
      if (useServerStore.getState().currentRoom) {
        set({ ...IDLE });
        return;
      }
      if (!queuedDecks.length) throw new Error("Choose a Commander deck to find a game.");
      set({
        phase: "queued",
        queuedAt: Date.now(),
        brackets: [...new Set(queuedDecks.map((deck) => deck.bracket))].sort(),
        queuedDecks,
      });
      await server.enterQueue({
        format: "Commander",
        podSizes,
        decks: queuedDecks,
        canHost: forgeWasmGate() === "in_browser",
      });
    } catch (error) {
      if (request !== preparation) return;
      set({ ...IDLE });
      throw error;
    }
  },
  async setSteps(steps) {
    const server = getPlatform().server;
    if (!server) return;
    if (useServerStore.getState().hasRelayFeature(RELAY_FEATURE.QueueSteps)) {
      await server.setQueueSteps(steps);
    } else {
      const decks = get().queuedDecks.map((deck) => deck.bracket);
      const low = Math.min(...decks);
      const high = Math.max(...decks);
      const distance = (bracket: number) => (bracket < low ? low - bracket : bracket - high);
      const added = steps
        .filter((bracket) => !get().brackets.includes(bracket))
        .sort((a, b) => distance(a) - distance(b));
      for (const bracket of added) await server.acceptQueueStep(bracket);
    }
    set({ offer: null });
  },
  dismissOffer() {
    set({ offer: null });
  },
  async acceptBotFill() {
    await getPlatform().server?.acceptBotFill();
    set({ botFillOffer: null, botFill: true });
  },
  dismissBotFill() {
    set({ botFillOffer: null });
  },
  async acceptMatch(deckIndex) {
    const { phase, accepted, proposal, proposalExpiresAt } = get();
    if (phase !== "proposed" || accepted || !proposalExpiresAt || Date.now() >= proposalExpiresAt)
      return;
    if (!proposal) return;
    const choices = queueDeckChoices(get().queuedDecks, proposal.bracket);
    if (deckIndex === undefined && choices.length !== 1) return;
    if (deckIndex !== undefined && !choices.some((choice) => choice.index === deckIndex)) return;
    set({ accepted: true });
    try {
      await getPlatform().server?.acceptMatch(deckIndex ?? choices[0].index);
    } catch (error) {
      if (get().proposal === proposal) set({ accepted: false });
      throw error;
    }
  },
  async declineMatch() {
    await getPlatform().server?.declineMatch();
    set({ ...IDLE });
  },
  async leave() {
    const wasPreparing = get().phase === "preparing";
    preparation++;
    if (!wasPreparing) await getPlatform().server?.leaveQueue();
    set({ ...IDLE });
  },
  clearMatch() {
    set({ phase: "idle", match: null });
  },
}));
