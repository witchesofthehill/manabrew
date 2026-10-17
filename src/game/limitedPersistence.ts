import { getPlatform } from "@/platform";
import { exportDraftClock } from "@/game/limitedDraftClock";
import { flushLimitedStorage, readLimitedSave, updateLimitedSave } from "@/game/limitedStorage";
import type { MpDraftConfig, MpDraftSeatAssignment } from "@/game/draftRelay";
import type {
  DraftState,
  WinstonState,
  LimitedDraftDecision,
  LimitedEngineCheckpoint,
} from "@/types/limited";
import type {
  LimitedSavedSession,
  LimitedSessionKind,
  LimitedVisibleState,
} from "@/game/limitedPersistence.types";

import { useLimitedDraftClockStore } from "@/stores/useLimitedDraftClockStore";
import { captureLimitedConnection } from "@/game/limitedConnection";
import { useServerStore } from "@/stores/useServerStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import type { DraftClockSnapshot } from "@/game/limitedDraftClock";
import {
  useLimitedBuildStore,
  reconcileLimitedBuildPool,
} from "@/components/limited/useLimitedBuildStore";
import type { BuildSession } from "@/components/limited/useLimitedBuildStore";
const operations = new Map<string, Promise<unknown>>();

export function serializeLimitedSession<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  operations.set(key, next);
  void next
    .finally(() => {
      if (operations.get(key) === next) operations.delete(key);
    })
    .catch(() => {});
  return next;
}

export function restoreLimitedBuild(sessionId: string, stored?: BuildSession): void {
  if (!stored) return;
  const current = useLimitedBuildStore.getState().sessions[sessionId];
  const storedIds = new Set(stored.pool.map((card) => card.id));
  if (
    current &&
    current.pool.length === stored.pool.length &&
    current.pool.every((card) => storedIds.has(card.id))
  )
    return;
  useLimitedBuildStore.setState((state) => ({
    sessions: { ...state.sessions, [sessionId]: stored },
  }));
}

export async function commitLimitedEngineSession(
  kind: LimitedSessionKind,
  sessionId: string,
  state: LimitedVisibleState,
  metadata: Partial<LimitedSavedSession> = {},
): Promise<LimitedSavedSession> {
  const platform = getPlatform();
  const checkpoint = await platform.invoke<LimitedEngineCheckpoint>("limited_export_session", {
    kind,
    sessionId,
  });
  const previousSave = await readLimitedSave(sessionId);
  const seat = metadata.seat ?? previousSave?.seat ?? 0;
  const history =
    kind === "draft" || kind === "winston"
      ? await platform.invoke<LimitedDraftDecision[]>("limited_get_draft_review", {
          kind,
          sessionId,
          seat,
        })
      : [];
  await flushLimitedStorage();
  if ((kind === "draft" || kind === "winston") && !metadata.build) {
    const builders = useLimitedBuildStore.getState();
    const build = builders.sessions[sessionId] ?? previousSave?.build;
    if (build)
      metadata = {
        ...metadata,
        build: reconcileLimitedBuildPool(
          build,
          (state as DraftState | WinstonState).pickedPile,
          builders.pendingPicks[sessionId],
        ),
      };
  }
  const saved = await updateLimitedSave(sessionId, (previous) => ({
    schemaVersion: 1,
    role: "solo",
    title:
      kind === "draft"
        ? "Booster Draft"
        : kind === "winston"
          ? "Winston Draft"
          : kind === "sealed"
            ? "Sealed"
            : "Limited matches",
    createdAt: Date.now(),
    archived: false,
    ...previous,
    ...metadata,
    sessionId,
    kind,
    checkpoint,
    state,
    history,
    seat,
    complete:
      "isComplete" in state ? state.isComplete : "completed" in state ? state.completed : false,
    clock: exportDraftClock(sessionId) ?? previous?.clock,
    updatedAt: Date.now(),
  }));
  return saved!;
}

export async function restoreLimitedEngine(
  sessionId: string,
  kind: LimitedSessionKind,
): Promise<LimitedSavedSession> {
  const saved = await readLimitedSave(sessionId);
  if (!saved || saved.kind !== kind || !saved.checkpoint)
    throw new Error(
      "No resumable engine checkpoint exists for this session. Saved decks remain available.",
    );
  if (saved.schemaVersion !== 1 || saved.checkpoint.schemaVersion !== 1)
    throw new Error(
      "This Limited checkpoint is incompatible with this app. Saved decks remain available.",
    );
  try {
    await getPlatform().invoke("limited_import_session", { checkpoint: saved.checkpoint });
  } catch (error) {
    throw new Error(
      `This Limited checkpoint could not be restored. Saved decks remain available. ${String(error)}`,
    );
  }
  const source = saved.sourceSessionId ? await readLimitedSave(saved.sourceSessionId) : null;
  restoreLimitedBuild(saved.sourceSessionId ?? sessionId, source?.build ?? saved.build);
  return saved;
}

export async function saveLimitedPeerDraft(
  state: DraftState,
  args: {
    roomId: string;
    config: MpDraftConfig;
    seats: MpDraftSeatAssignment[];
    mySeat: number;
    history?: LimitedDraftDecision[];
    connection?: LimitedSavedSession["connection"];
  },
): Promise<void> {
  const room = useServerStore.getState().currentRoom;
  const clock = useLimitedDraftClockStore.getState().sessions[state.sessionId];
  await flushLimitedStorage();
  const builders = useLimitedBuildStore.getState();
  const build = builders.sessions[state.sessionId];
  const pending = builders.pendingPicks[state.sessionId];
  const automatic =
    pending &&
    args.history?.some(
      (decision) => decision.automatic && decision.selectedIds.includes(pending.id),
    );
  await updateLimitedSave(state.sessionId, (previous) => ({
    schemaVersion: 1,
    title: "Booster Draft",
    createdAt: Date.now(),
    archived: false,
    ...previous,
    role: "peer",
    sessionId: state.sessionId,
    kind: "draft",
    build: build
      ? reconcileLimitedBuildPool(build, state.pickedPile, automatic ? undefined : pending)
      : previous?.build
        ? reconcileLimitedBuildPool(previous.build, state.pickedPile)
        : undefined,
    checkpoint: null,
    state,
    seat: args.mySeat,
    history: args.history ?? previous?.history ?? [],
    draftPeer: {
      sessionId: state.sessionId,
      roomId: args.roomId,
      config: args.config,
      seats: args.seats,
      mySeat: args.mySeat,
      state,
      amHost: false,
      mode: state.isComplete ? "complete" : "drafting",
      pickPending: false,
    },
    connection:
      args.connection ??
      (room
        ? captureLimitedConnection(room, state.sessionId, previous?.connection?.resume.game_id)
        : previous?.connection),
    complete: state.isComplete,
    clock: clock
      ? {
          ...clock,
          paused: true,
          seats: clock.seats
            .filter((entry) => entry.seat === args.mySeat)
            .map((entry) => ({
              ...entry,
              deadlineMs: null,
              remainingMs:
                entry.deadlineMs === null
                  ? entry.remainingMs
                  : Math.max(0, entry.deadlineMs - Date.now()),
            })),
        }
      : previous?.clock,
    updatedAt: Date.now(),
  }));
}

export async function saveLimitedPeerClock(
  sessionId: string,
  snapshot: DraftClockSnapshot,
  mySeat: number,
): Promise<void> {
  const draft = useMultiplayerDraftStore.getState();
  if (draft.sessionId !== sessionId || draft.mySeat !== mySeat || snapshot.sessionId !== sessionId)
    throw new Error("The peer's draft changed before its clock could be saved.");
  const room = useServerStore.getState().currentRoom;
  const now = Date.now();
  await flushLimitedStorage();
  await updateLimitedSave(sessionId, (previous) => {
    if (previous && (previous.kind !== "draft" || previous.role !== "peer"))
      throw new Error("A different Limited session owns this save.");
    return {
      schemaVersion: 1,
      title: "Booster Draft",
      createdAt: now,
      archived: false,
      state: draft.state,
      history: [],
      complete: draft.state?.isComplete ?? false,
      ...previous,
      sessionId,
      kind: "draft",
      role: "peer",
      checkpoint: null,
      seat: mySeat,
      draftPeer: previous?.draftPeer ?? {
        sessionId,
        roomId: draft.roomId,
        config: draft.config,
        seats: draft.seats,
        mySeat,
        state: draft.state,
        amHost: false,
        mode: draft.mode,
        pickPending: false,
      },
      connection: room
        ? captureLimitedConnection(room, sessionId, previous?.connection?.resume.game_id)
        : previous?.connection,
      clock: {
        ...snapshot,
        paused: true,
        seats: snapshot.seats
          .filter((entry) => entry.seat === mySeat)
          .map((entry) => ({
            ...entry,
            deadlineMs: null,
            remainingMs:
              entry.deadlineMs === null ? entry.remainingMs : Math.max(0, entry.deadlineMs - now),
          })),
      },
      updatedAt: now,
    };
  });
}
