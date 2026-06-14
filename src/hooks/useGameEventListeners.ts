import { useEffect } from "react";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { getSelectedGameRuntime } from "@/game";
import { useGameStore } from "@/stores/useGameStore";
import { clearActiveGameSession } from "@/lib/activeGameSession";
import { FORETELL_LOG_PREFIX, normalizeGameLogPayload, type GameLogEntry } from "@/types/gameLog";
import { normalizeSnapshotPayload } from "@/types/gameSnapshot";
import { applyDisplay, applyPrompt, applyState } from "@/stores/gameStore.constants";
import type { Prompt, StateUpdate } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { AuthResultPayload } from "@/types/server";

function normalizeEnginePrompt(prompt: unknown): Prompt | null {
  return typeof prompt === "object" && prompt !== null && "input" in prompt
    ? (prompt as Prompt)
    : null;
}

const { setState, getState } = useGameStore;

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

/**
 * Sets up platform event listeners for the three engine→UI message families:
 * `state` (game view), `display` (animations) and `prompt` (decisions).
 * State and display are applied for whichever player they are addressed to;
 * a prompt only becomes actionable when it is addressed to this player.
 */
export function useGameEventListeners() {
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
          applyState(payload.gameView, "Event", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<DisplayEvent>("game:display", (payload) => {
          if (!payload?.kind) return;
          applyDisplay(payload, "Event", setState, getState);
        }),
      );

      unsubscribers.push(
        platform.events.on<Prompt>("game:prompt", (payload) => {
          const prompt = normalizeEnginePrompt(payload);
          if (!prompt) return;
          if (getState().gameView?.gameOver) return;
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
        platform.events.on<{ state: StateUpdate }>("game:remote_state", (payload) => {
          if (!payload.state?.gameView) return;
          applyState(payload.state.gameView, "Remote", setState, getState);
        }),
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
            applyPrompt(prompt, "Remote", setState, getState);
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<AuthResultPayload>("server:auth_result", (payload) => {
          const state = getState();
          if (
            payload.success &&
            payload.reconnected &&
            state.isMultiplayer &&
            !state.isHost &&
            state.isGameActive
          ) {
            void platform.server?.requestResync();
          }
        }),
      );

      unsubscribers.push(
        platform.events.on("server:game_aborted", () => {
          const state = getState();
          if (!state.isMultiplayer || !state.isGameActive) return;
          if (state.gameView?.gameOver) return;
          clearActiveGameSession();
          toast.error("Game aborted — a player did not reconnect.");
          void useGameStore.getState().endGame();
        }),
      );

      unsubscribers.push(
        platform.events.on<{ reason: string; message: string }>("game:forced_end", (payload) => {
          const message = payload?.message ?? "Forced game exit";
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
