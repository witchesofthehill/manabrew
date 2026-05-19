import { useEffect } from "react";
import { getPlatform } from "@/platform";
import { getSelectedGameRuntime } from "@/game";
import { useGameStore } from "@/stores/useGameStore";
import { normalizeGameLogPayload } from "@/types/gameLog";
import { normalizeSnapshotPayload } from "@/types/gameSnapshot";
import { applyPrompt } from "@/stores/gameStore.constants";
import type { AgentPrompt } from "@/stores/gameStore.types";

function normalizeEnginePrompt(prompt: unknown): AgentPrompt | null {
  return typeof prompt === "object" && prompt !== null && "type" in prompt
    ? (prompt as AgentPrompt)
    : null;
}

/**
 * Hook that sets up platform event listeners for game state updates.
 * Works with both Tauri and Web platforms.
 * Automatically cleans up on unmount.
 */
export function useGameEventListeners() {
  useEffect(() => {
    const platform = getPlatform();
    const runtime = getSelectedGameRuntime();
    const unsubscribers: (() => void)[] = [];

    // Fetch initial game state on mount to handle race condition where
    // the game:prompt event was emitted before this component mounted
    const fetchInitialState = async () => {
      try {
        const prompt = normalizeEnginePrompt(await runtime.api.getPrompt());
        if (prompt?.gameView) {
          const currentView = useGameStore.getState().gameView;
          if (!currentView) {
            applyPrompt(prompt, "Initial", useGameStore.setState, useGameStore.getState);
          }
        }
      } catch (e) {
        // getPrompt may not be available on all platforms or if no game is active
        console.debug("[useGameEventListeners] Could not fetch initial state:", e);
      }
    };
    fetchInitialState();

    try {
      unsubscribers.push(
        platform.events.on<unknown>("game:prompt", (payload) => {
          const prompt = normalizeEnginePrompt(payload);
          if (!prompt) return;
          const activeRuntime = getSelectedGameRuntime();
          const gameView = useGameStore.getState().gameView;
          if (gameView?.gameOver) return;
          if (
            activeRuntime.capabilities.manualTabletop &&
            prompt?.gameView?.gameId !== gameView?.gameId
          ) {
            return;
          }
          if (prompt && prompt.gameView) {
            applyPrompt(prompt, "Event", useGameStore.setState, useGameStore.getState);
          }
        }),
      );

      unsubscribers.push(
        platform.events.on<unknown>("game:log", (payload) => {
          const entry = normalizeGameLogPayload(payload);
          useGameStore.setState((state) => ({
            gameLog: [...state.gameLog.slice(-199), entry],
          }));
        }),
      );

      unsubscribers.push(
        platform.events.on<unknown>("game:snapshot", (payload) => {
          const snapshot = normalizeSnapshotPayload(payload);
          if (!snapshot.gameView) return;
          useGameStore.setState((state) => ({
            snapshots: [
              ...state.snapshots
                .filter((s) => s.checkpointId !== snapshot.checkpointId)
                .slice(-199),
              snapshot,
            ],
          }));
        }),
      );

      // Remote prompt listener: receives prompts relayed via the server for non-host players
      unsubscribers.push(
        platform.events.on<{ kind: string; forPlayer: string; prompt: unknown }>(
          "game:remote_prompt",
          (payload) => {
            const { forPlayer } = payload;
            const prompt = normalizeEnginePrompt(payload.prompt);
            if (!prompt) return;
            const { myPlayerSlot } = useGameStore.getState();
            console.log(
              `[MP] remote_prompt ${prompt.type} for ${forPlayer} | mine=${myPlayerSlot} | ${
                forPlayer === myPlayerSlot ? "RENDER" : "sync-only"
              }`,
            );
            if (forPlayer === myPlayerSlot) {
              // This prompt is for us — render it fully.
              applyPrompt(prompt, "Remote", useGameStore.setState, useGameStore.getState);
            } else {
              // Keep shared turn/priority in sync even when the prompt is for another player.
              // Do not apply full foreign-perspective view (would leak/flip local actionability).
              const current = useGameStore.getState().gameView;
              if (current && prompt?.gameView) {
                useGameStore.setState({
                  gameView: {
                    ...current,
                    turn: prompt.gameView.turn,
                    step: prompt.gameView.step,
                    activePlayerId: prompt.gameView.activePlayerId,
                    priorityPlayerId: prompt.gameView.priorityPlayerId,
                    gameOver: prompt.gameView.gameOver,
                    winnerId: prompt.gameView.winnerId,
                  },
                  // Never keep a stale actionable prompt when priority is not ours.
                  currentPrompt: null,
                  isWaitingForResponse: false,
                  debugInfo: `Remote sync: ${prompt.type}`,
                });
              }
            }
          },
        ),
      );

      unsubscribers.push(
        platform.events.on<{ reason: string; message: string }>("game:forced_end", (payload) => {
          const message = payload?.message ?? "Forced game exit";
          useGameStore.setState({
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
