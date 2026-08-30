import { useLayoutEffect } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { resolvePrompt } from "./promptHandlers";

export function useAutoResolvePrompt(paused = false): void {
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);
  const respond = useGameStore((s) => s.respond);

  const showOverrides = usePromptPreferencesStore((s) => s.show);

  useLayoutEffect(() => {
    if (paused) return;
    if (!currentPrompt) return;
    if (isWaitingForResponse) return;

    const result = resolvePrompt(currentPrompt, {
      prefs: { show: showOverrides },
    });
    if (result.kind !== "auto") return;

    if (import.meta.env?.DEV) {
      console.debug(`[prompt-resolver] auto-respond ${currentPrompt.input.type}: ${result.reason}`);
    }
    appendAutoResolutionLog(currentPrompt.input.type, result.reason);
    void respond(result.respond);
  }, [paused, currentPrompt, isWaitingForResponse, respond, showOverrides]);
}

function appendAutoResolutionLog(promptType: string, reason: string): void {
  const entry = {
    message: `Auto-resolved ${promptType}: ${reason}`,
    entryType: "info" as const,
    timestampMs: Date.now(),
  };
  useGameStore.setState((state) => ({
    gameLog: [...state.gameLog.slice(-199), entry],
  }));
}
