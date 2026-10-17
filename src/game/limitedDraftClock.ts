import { isDraftRelay, makeDraftRelay } from "@/game/draftRelay";
import { getPlatform } from "@/platform";
import { useLimitedDraftClockStore } from "@/stores/useLimitedDraftClockStore";
import { useServerStore } from "@/stores/useServerStore";
import type { DraftClockStateMessage, DraftClockWireSeat } from "@/game/draftRelay";
import type { DraftState } from "@/types/limited";
import type { RoomRelayEnvelope } from "@/types/server";

export const DRAFT_CLOCK_FEATURE = "limited_draft_clocks";
export const MIN_PICK_SECONDS = 5;
export const MAX_PICK_SECONDS = 600;

export interface DraftClockSeat extends DraftClockWireSeat {
  nominatedId: string | null;
}

export interface DraftClockSnapshot {
  sessionId: string;
  pickSeconds: number;
  sequence: number;
  paused: boolean;
  seats: DraftClockSeat[];
}

export interface DraftClockOptions {
  sessionId: string;
  pickSeconds?: number;
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  onTimeout: (
    seat: number,
    revision: string,
    cardId?: string,
    clockSequence?: number,
  ) => Promise<void>;
  onChange?: () => Promise<void>;
  relay?: {
    roomId: string;
    hostSlot: string;
    seats?: Array<{ seat: number; playerSlot: string | null }>;
  };
}

interface Controller {
  snapshot: DraftClockSnapshot;
  options: DraftClockOptions;
  states: Map<number, DraftState>;
  timers: Map<number, ReturnType<typeof setTimeout>>;
  expiring: Set<string>;
  unsubscribe: () => void;
}

const controllers = new Map<string, Controller>();

export function draftDecisionRevision(state: DraftState): string {
  const input = `${state.sessionId}:${state.round}:${state.pickNumber}:${state.picksRemainingInPack}:${state.currentPack.map((card) => card.id).join("|")}`;
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < input.length; index++) {
    first = Math.imul(first ^ input.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ input.charCodeAt(index);
  }
  return `${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function remaining(seat: DraftClockSeat): number {
  return seat.deadlineMs === null ? seat.remainingMs : Math.max(0, seat.deadlineMs - Date.now());
}

function update(controller: Controller): void {
  useLimitedDraftClockStore.getState().setClock({
    ...controller.snapshot,
    seats: controller.snapshot.seats.map((seat) => ({ ...seat })),
  });
}

function schedule(controller: Controller): void {
  for (const timer of controller.timers.values()) clearTimeout(timer);
  controller.timers.clear();
  if (controller.snapshot.paused || controller.options.relay) return;
  for (const seat of controller.snapshot.seats) {
    controller.timers.set(
      seat.seat,
      setTimeout(() => {
        void expire(controller, seat.seat, seat.revision).catch((error: unknown) => {
          console.error("[draftClock] automatic pick failed", error);
        });
      }, remaining(seat)),
    );
  }
}

async function expire(controller: Controller, seatNumber: number, revision: string): Promise<void> {
  const key = `${seatNumber}:${revision}`;
  if (controller.expiring.has(key)) return;
  controller.expiring.add(key);
  try {
    if (controllers.get(controller.snapshot.sessionId) !== controller || controller.snapshot.paused)
      return;
    const seat = controller.snapshot.seats.find(
      (entry) => entry.seat === seatNumber && entry.revision === revision,
    );
    const state = controller.states.get(seatNumber);
    if (!seat || !state?.awaitingHuman || draftDecisionRevision(state) !== revision) return;
    await controller.options.onTimeout(
      seatNumber,
      revision,
      seat.nominatedId ?? undefined,
      controller.snapshot.sequence,
    );
  } finally {
    controller.expiring.delete(key);
  }
}

export function configureDraftClock(options: DraftClockOptions): void {
  disposeDraftClock(options.sessionId);
  if (!options.pickSeconds) return;
  const controller: Controller = {
    snapshot: {
      sessionId: options.sessionId,
      pickSeconds: options.pickSeconds,
      sequence: 0,
      paused: false,
      seats: [],
    },
    options,
    states: new Map(),
    timers: new Map(),
    expiring: new Set(),
    unsubscribe: () => {},
  };
  controllers.set(options.sessionId, controller);
  if (options.relay) {
    const offRelay = getPlatform().events.on<{ from_player: string; state: RoomRelayEnvelope }>(
      "server:room_message",
      (event) => {
        if (!isDraftRelay(event.state)) return;
        const envelope = event.state;
        const relay = options.relay!;
        if (
          envelope.roomId !== relay.roomId ||
          envelope.fromPlayer !== event.from_player ||
          envelope.payload.sessionId !== options.sessionId
        )
          return;
        const message = envelope.payload;
        const receivedAt = Date.now();
        if (
          event.from_player === relay.hostSlot &&
          message.type === "clockState" &&
          message.sequence >= controller.snapshot.sequence
        ) {
          void options
            .enqueue(async () => {
              if (message.sequence < controller.snapshot.sequence) return;
              controller.snapshot = draftClockStateSnapshot(
                { ...message, serverNowMs: message.serverNowMs + Date.now() - receivedAt },
                controller.snapshot,
              );
              await options.onChange?.();
              update(controller);
            })
            .catch((error: unknown) =>
              console.error("[draftClock] clock persistence failed", error),
            );
        } else if (
          event.from_player === relay.hostSlot &&
          message.type === "clockExpired" &&
          envelope.targetPlayer === relay.hostSlot &&
          message.sequence === controller.snapshot.sequence
        ) {
          void expire(controller, message.seat, message.revision).catch((error: unknown) =>
            console.error("[draftClock] automatic pick failed", error),
          );
        } else if (message.type === "nominate" && envelope.targetPlayer === relay.hostSlot) {
          const room = useServerStore.getState().currentRoom;
          const state = controller.states.get(message.seat);
          if (
            room?.players.some((seat) => seat.username === event.from_player && !seat.is_bot) &&
            relay.seats?.find((seat) => seat.seat === message.seat)?.playerSlot ===
              event.from_player &&
            state?.awaitingHuman
          ) {
            void nominateDraftFallback(
              options.sessionId,
              message.seat,
              message.revision,
              message.cardId,
            ).catch((error: unknown) => console.error("[draftClock] nomination failed", error));
          }
        }
      },
    );
    const offReconnect = getPlatform().events.on("server:reconnecting", () => {
      void pauseDraftClock(options.sessionId, true).catch((error: unknown) =>
        console.error("[draftClock] pause failed", error),
      );
    });
    const offRoom = getPlatform().events.on<{ room: { room_id: string; host: string } }>(
      "server:room_update",
      ({ room }) => {
        if (room.room_id === options.relay!.roomId && room.host === options.relay!.hostSlot)
          void options
            .enqueue(() => publishDraftClocks(options.sessionId))
            .catch((error: unknown) => console.error("[draftClock] clock sync failed", error));
      },
    );
    controller.unsubscribe = () => {
      offRelay();
      offReconnect();
      offRoom();
    };
  }
  update(controller);
}

export function syncDraftClocks(
  sessionId: string,
  states: Array<{ seat: number; state: DraftState }>,
): void {
  const controller = controllers.get(sessionId);
  if (!controller) return;
  for (const { seat, state } of states) controller.states.set(seat, state);
  const now = Date.now();
  const next: DraftClockSeat[] = [];
  for (const [seatNumber, state] of controller.states) {
    if (!state.awaitingHuman || state.isComplete || state.currentPack.length === 0) continue;
    const revision = draftDecisionRevision(state);
    const old = controller.snapshot.seats.find(
      (seat) => seat.seat === seatNumber && seat.revision === revision,
    );
    next.push(
      old ?? {
        seat: seatNumber,
        revision,
        remainingMs: controller.snapshot.pickSeconds * 1000,
        deadlineMs: controller.snapshot.paused
          ? null
          : now + controller.snapshot.pickSeconds * 1000,
        nominatedId: null,
      },
    );
  }
  if (
    next.length !== controller.snapshot.seats.length ||
    next.some((seat, index) => seat !== controller.snapshot.seats[index])
  )
    controller.snapshot.sequence++;
  controller.snapshot.seats = next;
}

export function exportDraftClock(sessionId: string): DraftClockSnapshot | undefined {
  const snapshot = controllers.get(sessionId)?.snapshot;
  if (!snapshot) return undefined;
  return {
    ...snapshot,
    seats: snapshot.seats.map((seat) => ({ ...seat, remainingMs: remaining(seat) })),
  };
}

export function restoreDraftClock(snapshot: DraftClockSnapshot, options: DraftClockOptions): void {
  configureDraftClock({ ...options, pickSeconds: snapshot.pickSeconds });
  const controller = controllers.get(snapshot.sessionId)!;
  controller.snapshot = {
    ...snapshot,
    sequence: (snapshot.sequence ?? 0) + 1,
    paused: true,
    seats: snapshot.seats.map((seat) => ({ ...seat, deadlineMs: null })),
  };
  update(controller);
}

export async function publishDraftClocks(sessionId: string): Promise<void> {
  const controller = controllers.get(sessionId);
  if (!controller) return;
  update(controller);
  schedule(controller);
  const relay = controller.options.relay;
  if (useServerStore.getState().reconnect.phase !== "idle") return;
  if (!relay) return;
  if (!useServerStore.getState().hasRelayFeature(DRAFT_CLOCK_FEATURE))
    throw new Error("Update the relay to use draft clocks.");
  await getPlatform().server?.sendRoomMessage(
    makeDraftRelay(
      {
        type: "clockSync",
        sessionId,
        sequence: controller.snapshot.sequence,
        paused: controller.snapshot.paused,
        seats: controller.snapshot.seats.map((seat) => ({
          seat: seat.seat,
          revision: seat.revision,
          remainingMs: remaining(seat),
          deadlineMs: null,
        })),
      },
      { roomId: relay.roomId, fromPlayer: relay.hostSlot },
    ),
  );
}

export async function pauseDraftClock(sessionId: string, paused: boolean): Promise<void> {
  const controller = controllers.get(sessionId);
  if (!controller) return;
  await controller.options.enqueue(async () => {
    if (controller.snapshot.paused === paused) return;
    const previous = {
      ...controller.snapshot,
      seats: controller.snapshot.seats.map((seat) => ({ ...seat })),
    };
    controller.snapshot.paused = paused;
    controller.snapshot.sequence++;
    controller.snapshot.seats = controller.snapshot.seats.map((seat) => {
      const remainingMs = remaining(seat);
      return { ...seat, remainingMs, deadlineMs: paused ? null : Date.now() + remainingMs };
    });
    try {
      await controller.options.onChange?.();
    } catch (error) {
      controller.snapshot = previous;
      throw error;
    }
    await publishDraftClocks(sessionId);
  });
}

export async function nominateDraftFallback(
  sessionId: string,
  seatNumber: number,
  revision: string,
  cardId: string | null,
): Promise<void> {
  const controller = controllers.get(sessionId);
  if (!controller) {
    const draft = useLimitedDraftClockStore.getState().sessions[sessionId];
    const room = useServerStore.getState().currentRoom;
    const username = useServerStore.getState().username;
    if (!draft || !room || !username) return;
    await getPlatform().server?.sendRoomMessage(
      makeDraftRelay(
        { type: "nominate", sessionId, seat: seatNumber, revision, cardId },
        { roomId: room.room_id, fromPlayer: username, targetPlayer: room.host },
      ),
    );
    return;
  }
  await controller.options.enqueue(async () => {
    const seat = controller.snapshot.seats.find(
      (entry) => entry.seat === seatNumber && entry.revision === revision,
    );
    const state = controller.states.get(seatNumber);
    if (
      !seat ||
      !state?.awaitingHuman ||
      (cardId !== null && !state.currentPack.some((card) => card.id === cardId))
    )
      return;
    const previous = seat.nominatedId;
    seat.nominatedId = cardId;
    try {
      await controller.options.onChange?.();
    } catch (error) {
      seat.nominatedId = previous;
      throw error;
    }
    update(controller);
    const relay = controller.options.relay;
    const targetPlayer = relay?.seats?.find((entry) => entry.seat === seatNumber)?.playerSlot;
    if (relay && targetPlayer && targetPlayer !== relay.hostSlot)
      await getPlatform().server?.sendRoomMessage(
        makeDraftRelay(
          { type: "clockNomination", sessionId, seat: seatNumber, revision, cardId },
          { fromPlayer: relay.hostSlot, roomId: relay.roomId, targetPlayer },
        ),
      );
  });
}

export function draftClockStateSnapshot(
  message: DraftClockStateMessage,
  current?: DraftClockSnapshot,
): DraftClockSnapshot {
  return {
    sessionId: message.sessionId,
    pickSeconds: current?.pickSeconds ?? 0,
    sequence: message.sequence,
    paused: message.paused,
    seats: message.seats.map((seat) => ({
      ...seat,
      deadlineMs:
        seat.deadlineMs === null
          ? null
          : Date.now() + Math.max(0, seat.deadlineMs - message.serverNowMs),
      nominatedId:
        current?.seats.find((entry) => entry.seat === seat.seat && entry.revision === seat.revision)
          ?.nominatedId ?? null,
    })),
  };
}

export function disposeDraftClock(sessionId: string): void {
  const controller = controllers.get(sessionId);
  if (controller) {
    controller.unsubscribe();
    for (const timer of controller.timers.values()) clearTimeout(timer);
    controllers.delete(sessionId);
  }
  useLimitedDraftClockStore.getState().clearClock(sessionId);
}
