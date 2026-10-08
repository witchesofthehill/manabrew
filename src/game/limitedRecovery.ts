import { getPlatform } from "@/platform";
import { useLimitedStore, configureSoloDraftClock } from "@/stores/useLimitedStore";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { useMultiplayerSealedStore } from "@/stores/useMultiplayerSealedStore";
import { useLimitedDraftClockStore } from "@/stores/useLimitedDraftClockStore";
import { useServerStore } from "@/stores/useServerStore";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { useLimitedOpeningStore } from "@/components/limited/limitedOpeningStore";
import {
  restoreLimitedBuild,
  restoreLimitedEngine,
  serializeLimitedSession,
} from "@/game/limitedPersistence";
import { readLimitedSave, updateLimitedSave, flushLimitedStorage } from "@/game/limitedStorage";
import { restoreDraftHost } from "@/game/draftHost";
import { attachDraftPeer, requestDraftResync } from "@/game/draftPeer";
import {
  attachLimitedSessionPeer,
  restoreLimitedHostSession,
  republishLimitedHostSession,
  requestLimitedResync,
  recoverLimitedMatchReturn,
} from "@/game/limitedSession";
import { syncDraftClocks, publishDraftClocks } from "@/game/limitedDraftClock";
import { resolveSealedPool } from "@/lib/limited.utils";
import { restoreGauntletProgress } from "@/lib/gauntletReturn";
import { useGameStore } from "@/stores/useGameStore";
import { clearActiveGameSession } from "@/lib/activeGameSession";
import type { DraftState, WinstonState, SealedPool, GauntletState } from "@/types/limited";
import type { MultiplayerLimitedState } from "@/stores/useMultiplayerLimitedStore";
import type { MultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import type { ResumeRoomParams } from "@/platform/types";
import { SERVER_ERROR_CODE } from "@/types/server";
import type { RoomInfo, RoomUpdatePayload, ServerErrorPayload } from "@/types/server";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";

export function limitedSessionRoute(saved: LimitedSavedSession): string {
  if (saved.role === "host" || saved.role === "peer")
    return saved.kind === "draft" ? "/draft/multiplayer" : "/sealed/multiplayer";
  return `/${saved.kind}/${saved.sessionId}`;
}

async function reconnect(saved: LimitedSavedSession): Promise<void> {
  const connection = saved.connection;
  if (!connection)
    throw new Error(
      "This multiplayer save has no relay connection metadata. Its saved decks are retained.",
    );
  let server = useServerStore.getState();
  if (server.connected && server.username !== connection.username)
    throw new Error(`Reconnect as ${connection.username} to resume this seat.`);
  if (!server.connected) {
    useServerStore.setState({ currentRoom: null });
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const timeout = setTimeout(() => {
      off();
      reject(new Error("The relay did not authenticate this saved seat. Reconnect and retry."));
    }, 15000);
    const off = useServerStore.subscribe((state) => {
      if (state.connected) {
        clearTimeout(timeout);
        off();
        resolve();
      } else if (state.error && !state.connecting) {
        clearTimeout(timeout);
        off();
        reject(new Error(state.error));
      }
    });
    try {
      if (!server.connecting)
        await server.connect(
          connection.host,
          connection.port,
          connection.username,
          connection.password,
        );
      await promise;
    } catch (error) {
      clearTimeout(timeout);
      off();
      throw error;
    }
  }
  server = useServerStore.getState();
  if (server.username !== connection.username)
    throw new Error("The authenticated relay seat does not match this save.");
  if (!server.hasRelayFeature("limited_session_recovery"))
    throw new Error(
      "Update the relay before restoring this durable Limited session. Your saved decks are retained.",
    );
  const platform = getPlatform();
  if (saved.role === "host") {
    if (!platform.server?.resumeRoom)
      throw new Error("This platform cannot rebind a saved Limited room.");
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    const timeout = setTimeout(() => {
      offRoom();
      offError();
      reject(
        new Error("The relay did not confirm the restored Limited room. Your save is retained."),
      );
    }, 10000);
    const finish = () => {
      clearTimeout(timeout);
      offRoom();
      offError();
    };
    const offRoom = platform.events.on<RoomUpdatePayload>("server:room_update", (event) => {
      if (event.room.room_id !== connection.room.room_id || event.room.host !== connection.username)
        return;
      const match = (saved.peerSession as Partial<MultiplayerLimitedState> | undefined)
        ?.matchReturn;
      if (!match || useServerStore.getState().currentRoom?.room_id !== match.roomId)
        useServerStore.setState({ currentRoom: event.room, roomPassword: connection.roomPassword });
      finish();
      resolve();
    });
    const offError = platform.events.on<ServerErrorPayload>("server:error", (event) => {
      finish();
      reject(new Error(event.message));
    });
    try {
      await platform.server.resumeRoom(connection.resume as ResumeRoomParams);
      await promise;
    } catch (error) {
      finish();
      throw error;
    }
  } else {
    const match = (saved.peerSession as Partial<MultiplayerLimitedState> | undefined)?.matchReturn;
    const desiredRoom = match?.roomId ?? connection.room.room_id;
    if (
      server.currentRoom?.room_id !== desiredRoom &&
      server.currentRoom?.room_id !== connection.room.room_id
    ) {
      const joined: { room: RoomInfo | null } = { room: null };
      const offRoom = platform.events.on<RoomUpdatePayload>("server:room_update", (event) => {
        const room = event.room;
        if (room.room_id !== desiredRoom && room.room_id !== connection.room.room_id) return;
        if (
          room.host !==
          (room.room_id === connection.room.room_id ? connection.room.host : match?.host)
        )
          return;
        if (
          !room.players.some(
            (player) =>
              player.username === connection.username && player.connected && !player.is_bot,
          )
        )
          return;
        joined.room = room;
      });
      try {
        try {
          await server.joinRoom(desiredRoom, connection.roomPassword ?? undefined);
        } catch (error) {
          const code = error instanceof Error ? error.message : String(error);
          if (code !== SERVER_ERROR_CODE.AlreadyInRoom || !joined.room) {
            if (
              !match ||
              (code !== SERVER_ERROR_CODE.RoomNotFound &&
                code !== SERVER_ERROR_CODE.IncorrectPassword &&
                code !== SERVER_ERROR_CODE.GameAlreadyStarted)
            )
              throw error;
            await server.joinRoom(connection.room.room_id, connection.roomPassword ?? undefined);
          }
        }
        if (!joined.room)
          throw new Error(
            "The relay did not restore your seat with its original room host. Your saved build is retained.",
          );
        useServerStore.setState({
          currentRoom: joined.room,
          roomPassword: connection.roomPassword,
        });
      } finally {
        offRoom();
      }
    }
  }
  attachDraftPeer(connection.username);
  attachLimitedSessionPeer();
}

export async function resumeLimitedSession(sessionId: string): Promise<LimitedSavedSession> {
  const restored = await serializeLimitedSession(sessionId, async () => {
    const saved = await readLimitedSave(sessionId);
    if (!saved) throw new Error("This saved Limited session was deleted.");
    const source =
      saved.kind === "gauntlet" && saved.sourceSessionId
        ? await readLimitedSave(saved.sourceSessionId)
        : null;
    const buildKey = saved.sourceSessionId ?? sessionId;
    restoreLimitedBuild(buildKey, source?.build ?? saved.build);
    if (saved.opening)
      useLimitedOpeningStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            openedIds: [
              ...new Set([
                ...(state.sessions[sessionId]?.openedIds ?? []),
                ...saved.opening!.openedIds,
              ]),
            ],
            completed: Boolean(state.sessions[sessionId]?.completed || saved.opening!.completed),
          },
        },
      }));
    await flushLimitedStorage();
    if (saved.role === "review")
      throw new Error(
        "Imported reviews are read-only. Their named builds and card printings remain available in Review.",
      );
    if (saved.role !== "peer") await restoreLimitedEngine(sessionId, saved.kind);
    if (saved.role === "solo") {
      if (saved.kind === "draft") {
        const state = await getPlatform().invoke<DraftState>("limited_get_draft_state", {
          sessionId,
        });
        useLimitedBuildStore.getState().reconcilePool(buildKey, state.pickedPile);
        useLimitedStore.setState({ activeDraft: state, lastError: null });
        if (saved.clock) {
          configureSoloDraftClock(sessionId, undefined, saved.clock);
          syncDraftClocks(sessionId, [{ seat: 0, state }]);
          await publishDraftClocks(sessionId);
        }
      } else if (saved.kind === "winston") {
        const state = await getPlatform().invoke<WinstonState>("limited_get_winston_state", {
          sessionId,
        });
        useLimitedBuildStore.getState().reconcilePool(buildKey, state.pickedPile);
        useLimitedStore.setState({ activeWinston: state, lastError: null });
      } else if (saved.kind === "sealed") {
        const state = await resolveSealedPool(saved.state as SealedPool);
        useLimitedBuildStore.getState().reconcilePool(buildKey, state.cards);
        useLimitedStore.setState({ activeSealed: state, lastError: null });
      } else {
        if (saved.gauntletProgress)
          await restoreGauntletProgress(sessionId, saved.gauntletProgress);
        useLimitedStore.setState({ activeGauntlet: saved.state as GauntletState, lastError: null });
      }
    } else {
      if (saved.draftPeer)
        useMultiplayerDraftStore.setState({
          ...(saved.draftPeer as Partial<MultiplayerDraftStore>),
          pickPending: false,
          lastError: null,
        });
      if (saved.peerSession)
        useMultiplayerLimitedStore.setState({
          ...(saved.peerSession as Partial<MultiplayerLimitedState>),
          lastError: null,
        });
      if (saved.clock && saved.role === "peer")
        useLimitedDraftClockStore.getState().setClock({ ...saved.clock, paused: true });
      await reconnect(saved);
      if (saved.role === "host") {
        if (saved.draftHost) await restoreDraftHost(saved);
        if (saved.hostSession) {
          await restoreLimitedHostSession(saved);
          await republishLimitedHostSession();
        }
      } else {
        const local = useMultiplayerLimitedStore.getState();
        if (local.sealed && local.originalRoom && local.sessionId)
          useMultiplayerSealedStore.getState().enter({
            roomId: local.originalRoom.room_id,
            setCode: local.sealed.deckName,
            pool: local.pool,
            sessionId: local.sessionId,
          });
        await requestDraftResync();
        await requestLimitedResync();
      }
    }
    await flushLimitedStorage();
    await updateLimitedSave(
      sessionId,
      (latest) => latest && { ...latest, archived: false, updatedAt: Date.now() },
    );
    return saved;
  });
  const marker = useMultiplayerLimitedStore.getState().matchReturn;
  const server = useServerStore.getState();
  if (marker && !useGameStore.getState().isGameActive) {
    if (
      marker.host === server.username ||
      server.currentRoom?.room_id !== marker.roomId ||
      server.currentRoom.status !== "InGame"
    ) {
      await recoverLimitedMatchReturn();
      clearActiveGameSession();
    } else await getPlatform().server?.requestResync();
  }
  return restored;
}
