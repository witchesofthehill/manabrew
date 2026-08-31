import { useEffect } from "react";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import {
  getSelectedGameRuntime,
  isRoomRelayProtocol,
  SELF_HOSTED_NODE_RELAY_PROTOCOL,
} from "@/game";
import { teardownForgeAiSession } from "@/game/hostedAiPlay";
import { reportEngineStats } from "@/lib/engineStatsReport";
import { reportOfflineGame, type OfflineSeatOutcome } from "@/lib/offlinePlayRecord";
import { clearLocalGame } from "@/lib/localGamePresence";
import { useAuthStore } from "@/stores/useAuthStore";
import { useGameStore } from "@/stores/useGameStore";
import type { GameState } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
import { SELF_RECONNECT_WINDOW_S } from "@/hooks/useMultiplayerInterruption";
import { clearActiveGameSession, peekActiveGameSession } from "@/lib/activeGameSession";
import { FORETELL_LOG_PREFIX, normalizeGameLogPayload, type GameLogEntry } from "@/types/gameLog";
import { normalizeSnapshotPayload } from "@/types/gameSnapshot";
import {
  applyDisplay,
  applyPrompt,
  applyProtocolError,
  applyState,
} from "@/stores/gameStore.constants";
import type { Prompt, StateUpdate, ProtocolError } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { GameViewDto } from "@/protocol/game";
import { SERVER_ERROR_CODE } from "@/types/server";
import type { AuthResultPayload, GameAbortedPayload, RoomMessagePayload } from "@/types/server";

type SelfHostedNodeRoomPayload = {
  type?: unknown;
  gameId?: unknown;
};

const GAME_OVER_PROMPT = { input: { type: "gameOver" } } as Prompt;

function isGameOverPrompt(prompt: Prompt | null): boolean {
  return prompt?.input.type === "gameOver";
}

function isSelfHostedNodeGameOverPayload(payload: unknown, gameId: string | null): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as SelfHostedNodeRoomPayload).type === "gameOver" &&
    (payload as SelfHostedNodeRoomPayload).gameId === gameId
  );
}

function normalizeEnginePrompt(prompt: unknown): Prompt | null {
  return typeof prompt === "object" && prompt !== null && "input" in prompt
    ? (prompt as Prompt)
    : null;
}

const { setState, getState } = useGameStore;

const REJOIN_RETRY_DELAY_MS = 2000;
let rejoinInFlight = false;

function setReconnectPhase(phase: "reconnecting" | "idle") {
  useServerStore.setState({
    reconnect:
      phase === "reconnecting"
        ? { phase, attempt: 1, reason: "network" }
        : { phase: "idle", attempt: 0 },
  });
}

async function rejoinAfterRelayRestart() {
  // Hold the interruption overlay up until the seat is re-established — the
  // socket being open again is not enough, and answering a stale prompt while
  // seatless gets the client force-ended with `not_in_room`.
  setReconnectPhase("reconnecting");
  if (rejoinInFlight) return;
  rejoinInFlight = true;
  try {
    const server = useServerStore.getState();
    const roomId = server.currentRoom?.room_id ?? peekActiveGameSession()?.roomId;
    if (!roomId) {
      setReconnectPhase("idle");
      return;
    }
    const deadline = Date.now() + SELF_RECONNECT_WINDOW_S * 1000;
    while (Date.now() < deadline) {
      if (!getState().isGameActive) {
        setReconnectPhase("idle");
        return;
      }
      try {
        await useServerStore
          .getState()
          .joinRoom(roomId, useServerStore.getState().roomPassword ?? undefined);
        void getPlatform().server?.requestResync();
        setReconnectPhase("idle");
        return;
      } catch (error) {
        // game_already_started means the room is InGame with no disconnected
        // seat left for this username — the grace timer forfeited it, and no
        // retry can bring it back.
        if (
          error instanceof Error &&
          error.message === SERVER_ERROR_CODE.GameAlreadyStarted &&
          getState().isGameActive
        ) {
          setReconnectPhase("idle");
          toast.error("Your seat was forfeited while you were disconnected.");
          void useGameStore.getState().endGame();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, REJOIN_RETRY_DELAY_MS));
      }
    }
    setReconnectPhase("idle");
    if (getState().isGameActive) {
      toast.error("Game could not be resumed — the room did not come back.");
      void useGameStore.getState().endGame();
    }
  } finally {
    rejoinInFlight = false;
  }
}

function toastOpponentPublicAction(entry: GameLogEntry) {
  if (!entry.playerId) return;
  const players = getState().gameView?.players ?? [];
  const me =
    players.find((p) => p.id === getState().myPlayerSlot) ??
    players.find((p) => p.isHuman) ??
    players[0];
  if (!me || entry.playerId === me.id) return;
  const actor = players.find((p) => p.id === entry.playerId)?.name ?? "Opponent";
  if (entry.message.startsWith(FORETELL_LOG_PREFIX)) {
    toast.info(`${actor} foretold a card`);
  }
}

function isOver(state: Pick<GameState, "gameView" | "currentPrompt">): boolean {
  return (state.gameView?.gameOver ?? false) || isGameOverPrompt(state.currentPrompt);
}

/**
 * The human's name comes from the account when there is one, so an offline game
 * joins the same player's relay games rather than a second identity.
 */
function offlineSeats(state: GameState): OfflineSeatOutcome[] {
  const handle = useAuthStore.getState().account?.handle;
  return (state.gameView?.players ?? []).map((player) => ({
    seatId: player.id,
    username: player.isHuman ? (handle ?? player.name) : player.name,
    isBot: !player.isHuman,
    conceded: player.status === "conceded",
  }));
}

/** Close the book on the current game. Safe to call more than once. */
function reportEngineGame(): void {
  const state = useGameStore.getState();
  if (!state.isMultiplayer) {
    clearLocalGame();
    const players = state.gameView?.players ?? [];
    const winnerId = state.gameView?.winnerId ?? null;
    reportOfflineGame({
      gameOver: isOver(state),
      winner: players.find((player) => player.id === winnerId)?.name ?? null,
      seats: offlineSeats(state),
    });
  }
  reportEngineStats({
    multiplayer: state.isMultiplayer,
    seats: Object.keys(state.gameDecks).length || 2,
    format: state.gameConfig?.formatId ?? null,
    // Must be the same test that decides a game is over: on the hosted path the
    // engine sends a gameOver prompt and `gameView` never gets the flag, so
    // reading the flag alone filed finished games as quits.
    endReason: isOver(state) ? "gameOver" : "left",
    gameId: useServerStore.getState().gameId ?? null,
    send: state.isMultiplayer
      ? async (stats, gameId) => {
          await getPlatform().server?.reportEngineStats(stats, gameId);
        }
      : undefined,
  });
}

/**
 * Sets up platform event listeners for the four engine→UI message families:
 * `state` (game view), `display` (animations), `prompt` (decisions) and
 * `error` (a rejected response — the engine re-sends the open prompt after it).
 * State and display are applied for whichever player they are addressed to;
 * a prompt or error only becomes actionable when it is addressed to this player.
 */
export function useGameEventListeners() {
  useEffect(() => {
    window.addEventListener("pagehide", reportEngineGame);
    // A finished game is reported the moment it finishes, not at teardown:
    // teardown is three seconds later, and by then the tab may be gone, the
    // socket closed or a pooled hosted room recycled out from under the seat.
    // Reporting twice is free — the summary is drained by the first caller.
    const unsubscribe = useGameStore.subscribe((state, previous) => {
      if (isOver(state) && !isOver(previous)) reportEngineGame();
    });
    return () => {
      window.removeEventListener("pagehide", reportEngineGame);
      unsubscribe();
      reportEngineGame();
    };
  }, []);

  useEffect(() => {
    const platform = getPlatform();
    const runtime = getSelectedGameRuntime();
    const unsubscribers: (() => void)[] = [];

    const fetchInitialState = async () => {
      try {
        const prompt = normalizeEnginePrompt(await runtime.api.getPrompt());
        if (prompt && !getState().currentPrompt) {
          applyPrompt(prompt, "Initial", setState, getState);
        }
      } catch (e) {
        console.debug("[useGameEventListeners] Could not fetch initial state:", e);
      }
    };
    fetchInitialState();

    if (getState().isMultiplayer && !getState().isHost) {
      void platform.server?.requestResync();
    }

    try {
      unsubscribers.push(
        platform.events.on<StateUpdate>("game:state", (payload) => {
          if (!payload?.gameView) return;
          applyState(payload.gameView as GameViewDto, "Event", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<DisplayEvent>("game:display", (payload) => {
          if (!payload?.kind) return;
          applyDisplay(payload, "Event", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<{ message: string }>("game:fatal", (payload) => {
          setState({
            fatalError: payload?.message || "The game failed to start.",
            isPrefetchingCards: false,
          });
        }),
      );

      // The card archive downloads on the first Manabrew-engine game, behind
      // the loading screen. Without this the screen sits on "Start the game
      // engine" with nothing to show for a 29 MB fetch.
      unsubscribers.push(
        platform.events.on<{ stage: string; loaded?: number; total?: number }>(
          "engine:cards",
          (payload) => {
            if (payload?.stage === "downloading" && payload.total) {
              const pct = Math.round(((payload.loaded ?? 0) / payload.total) * 100);
              setState({ debugInfo: `Downloading card data ${pct}%` });
            } else if (payload?.stage === "parsing") {
              setState({ debugInfo: "Parsing card data..." });
            }
          },
        ),
      );

      const handleProtocolError = (error: ProtocolError | undefined, source: string) => {
        if (!error?.code) return;
        applyProtocolError(error, source, setState);
        toast.error(`Action rejected (${error.code}) — try again`);
      };

      unsubscribers.push(
        platform.events.on<ProtocolError>("game:error", (payload) => {
          handleProtocolError(payload, "Event");
        }),
      );

      unsubscribers.push(
        platform.events.on<Prompt>("game:prompt", (payload) => {
          const prompt = normalizeEnginePrompt(payload);
          if (!prompt) return;
          if (getState().gameView?.gameOver) return;
          if (getState().selfConceded) return;
          applyPrompt(prompt, "Event", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<unknown>("game:log", (payload) => {
          const entry = normalizeGameLogPayload(payload);
          setState((state) => ({
            gameLog: [...state.gameLog.slice(-199), entry],
          }));
          toastOpponentPublicAction(entry);
        }),
      );

      unsubscribers.push(
        platform.events.on<unknown>("game:snapshot", (payload) => {
          const snapshot = normalizeSnapshotPayload(payload);
          if (!snapshot.gameView) return;
          setState((state) => ({
            snapshots: [
              ...state.snapshots
                .filter((s) => s.checkpointId !== snapshot.checkpointId)
                .slice(-199),
              snapshot,
            ],
          }));
        }),
      );

      // Relay (non-host) seats receive state/display/prompt addressed per player.
      unsubscribers.push(
        platform.events.on<{ forPlayer?: string; state: StateUpdate }>(
          "game:remote_state",
          (payload) => {
            if (!payload.state?.gameView) return;
            if (payload.forPlayer) {
              if (payload.forPlayer !== getState().myPlayerSlot) return;
              if (!getState().seatAddressedStates) setState({ seatAddressedStates: true });
            } else if (getState().seatAddressedStates) {
              // Public (spectator) broadcast; this seat gets addressed views.
              return;
            }
            applyState(payload.state.gameView as GameViewDto, "Remote", setState, getState);
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<{ event: DisplayEvent }>("game:remote_display", (payload) => {
          if (!payload.event?.kind) return;
          applyDisplay(payload.event, "Remote", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<{ forPlayer: string; prompt: Prompt }>(
          "game:remote_prompt",
          (payload) => {
            if (payload.forPlayer !== getState().myPlayerSlot) return;
            const prompt = normalizeEnginePrompt(payload.prompt);
            if (!prompt) return;
            if (getState().selfConceded) return;
            applyPrompt(prompt, "Remote", setState, getState);
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<{ forPlayer: string; error: ProtocolError }>(
          "game:remote_error",
          (payload) => {
            if (payload.forPlayer !== getState().myPlayerSlot) return;
            handleProtocolError(payload.error, "Remote");
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<AuthResultPayload>("server:auth_result", (payload) => {
          const state = getState();
          if (!payload.success || !state.isMultiplayer || !state.isGameActive) return;
          if (payload.reconnected) {
            if (!state.isHost) void platform.server?.requestResync();
            return;
          }
          if (state.isHost) {
            void useServerStore.getState().resumeRoomAfterRestart();
          } else {
            void rejoinAfterRelayRestart();
          }
        }),
      );

      unsubscribers.push(
        platform.events.on<RoomMessagePayload<SelfHostedNodeRoomPayload>>(
          "server:room_message",
          (payload) => {
            if (
              !isRoomRelayProtocol<SelfHostedNodeRoomPayload>(
                payload.state,
                SELF_HOSTED_NODE_RELAY_PROTOCOL,
              )
            ) {
              return;
            }
            const serverState = useServerStore.getState();
            if (payload.from_player !== serverState.currentRoom?.host) return;
            if (!isSelfHostedNodeGameOverPayload(payload.state.payload, serverState.gameId)) return;
            const state = getState();
            if (!state.isMultiplayer || !state.isGameActive) return;
            if (state.gameView?.gameOver || isGameOverPrompt(state.currentPrompt)) return;
            setState({
              currentPrompt: GAME_OVER_PROMPT,
              isWaitingForResponse: false,
              debugInfo: "Remote: gameOver",
            });
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<GameAbortedPayload>("server:game_aborted", (payload) => {
          const state = getState();
          if (!state.isMultiplayer || !state.isGameActive) return;
          const roomId =
            peekActiveGameSession()?.roomId ?? useServerStore.getState().currentRoom?.room_id;
          if (roomId && payload.room_id !== roomId) return;
          if (state.gameView?.gameOver || isGameOverPrompt(state.currentPrompt)) return;
          toast.error("Game aborted — a player did not reconnect.");
          void useGameStore.getState().endGame();
        }),
      );

      unsubscribers.push(
        platform.events.on<{ reason: string; message: string }>("game:forced_end", (payload) => {
          const message = payload?.message ?? "Forced game exit";
          const { isMultiplayer, isHost } = getState();
          const activeSession = peekActiveGameSession();
          clearActiveGameSession();
          setState({
            isGameActive: false,
            gameView: null,
            currentPrompt: null,
            deferredQueue: [],
            isFlashing: false,
            isWaitingForResponse: false,
            isMultiplayer: false,
            isHost: false,
            myPlayerSlot: null,
            snapshots: [],
            debugInfo: `Game ended: ${message}`,
          });
          // Without EndGame the relay room stays InGame and every rematch
          // action bounces off "Game has already started".
          if (isMultiplayer && isHost) {
            toast.error("Game ended unexpectedly — returning the room to the lobby.");
            void useServerStore.getState().endGame();
          } else if (activeSession?.ownsForgeHost || activeSession?.relayHost) {
            void teardownForgeAiSession(activeSession);
          }
        }),
      );
    } catch (e) {
      console.error("[hook] Failed to setup listeners:", e);
    }

    return () => {
      unsubscribers.forEach((fn) => fn());
    };
  }, []);
}
