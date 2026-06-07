import { useEffect, useLayoutEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { useTargetIntentStore } from "@/stores/useTargetIntentStore";
import { resolvePrompt } from "./promptHandlers";

export function useAutoResolvePrompt(): void {
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);
  const isGameActive = useGameStore((s) => s.isGameActive);
  const respond = useGameStore((s) => s.respond);

  const showOverrides = usePromptPreferencesStore((s) => s.show);
  const triggerMemory = usePromptPreferencesStore((s) => s.triggerMemory);
  const targetIntents = useTargetIntentStore((s) => s.intents);

  const wasActive = useRef(false);
  useEffect(() => {
    if (isGameActive && !wasActive.current) {
      usePromptPreferencesStore.getState().resetForNewGame();
      useTargetIntentStore.getState().clearAll();
    }
    wasActive.current = isGameActive;
  }, [isGameActive]);

  useLayoutEffect(() => {
    if (!currentPrompt) return;
    if (isWaitingForResponse) return;

    const result = resolvePrompt(currentPrompt, {
      prefs: { show: showOverrides, triggerMemory },
      targetIntents,
    });
    if (result.kind !== "auto") return;

    if (import.meta.env?.DEV) {
      console.debug(`[prompt-resolver] auto-respond ${currentPrompt.input.type}: ${result.reason}`);
    }
    appendAutoResolutionLog(currentPrompt.input.type, result.reason);
    void respond(result.respond);
  }, [currentPrompt, isWaitingForResponse, respond, showOverrides, triggerMemory, targetIntents]);
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
