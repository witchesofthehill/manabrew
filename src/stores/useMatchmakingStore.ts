import { create } from "zustand";
import { forgeWasmGate } from "@/lib/forgeWasm";
import { localGameActive, onLocalGameEnd } from "@/lib/localGamePresence";
import { playSound } from "@/lib/soundRuntime";
import { getPlatform } from "@/platform";
import type {
  MatchFoundPayload,
  MatchProposalPayload,
  QueueBotFillOfferPayload,
  QueueBracketCount,
  QueuedDeck,
  QueueStatusPayload,
  QueueStepOfferPayload,
  TableCallPayload,
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

function requestCallNotifications(): void {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  void Notification.requestPermission().catch(() => undefined);
}

function notifyTableCall(call: TableCallPayload): void {
  playSound("roomInvite");
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!document.hidden) return;
  const notification = new Notification(`A ${tableLabel(call.pod_size)} needs players`, {
    body: `${call.host} opened a bracket ${call.bracket} table. ${call.seats} seat(s) open.`,
    tag: `table-call-${call.room_id}`,
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
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
  accepted: boolean;
  match: MatchFoundPayload | null;
  tableCall: TableCallPayload | null;
  answerTableCall(join: boolean): Promise<void>;
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
  | "phase"
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
  queuedAt: null,
  brackets: [],
  waiting: [],
  offer: null,
  botFillOffer: null,
  botFill: false,
  proposal: null,
  accepted: false,
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
    events.on<TableCallPayload>("server:table_call", (payload) => {
      set({ tableCall: payload });
      notifyTableCall(payload);
    }),
    events.on<MatchFoundPayload>("server:match_found", (payload) => {
      set({ ...IDLE, phase: "matched", match: payload, tableCall: null });
    }),
    events.on("server:disconnected", () => {
      set({ ...IDLE, tableCall: null });
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
  tableCall: null,
  async answerTableCall(join) {
    const call = get().tableCall;
    if (!call) return;
    set({ tableCall: null });
    await getPlatform().server?.answerTableCall(call.room_id, join);
  },
  async enter(podSizes, decks) {
    const server = getPlatform().server;
    if (!server) throw new Error("Multiplayer is not available.");
    listen(set, get);
    requestCallNotifications();
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
    set({ accepted: true });
    await getPlatform().server?.acceptMatch();
  },
  async declineMatch() {
    set({ ...IDLE });
    await getPlatform().server?.declineMatch();
  },
  async leave() {
    set({ ...IDLE, tableCall: null });
    await getPlatform().server?.leaveQueue();
  },
  clearMatch() {
    set({ phase: "idle", match: null });
  },
}));
