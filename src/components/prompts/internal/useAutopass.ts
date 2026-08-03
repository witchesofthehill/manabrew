import { useState } from "react";
import type { Prompt } from "@/protocol";
import { useGameStore } from "@/stores/useGameStore";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { useGameDevStore } from "@/stores/useGameDevStore";

function isDeadWindow(prompt: Prompt): boolean {
  if (prompt.input.type !== "chooseAction") return false;
  return prompt.input.actions.every((a) => a.type === "activateAbility" && a.isManaAbility);
}

export function useAutopass(): { counting: boolean; hold: () => void } {
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const isWaitingForResponse = useGameStore((s) => s.isWaitingForResponse);
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const devOverride = useGameDevStore((s) => s.promptActionOverride);
  const [heldPrompt, setHeldPrompt] = useState<Prompt | null>(null);

  const counting =
    !fullControl &&
    devOverride == null &&
    !isWaitingForResponse &&
    currentPrompt != null &&
    currentPrompt !== heldPrompt &&
    isDeadWindow(currentPrompt);

  return {
    counting,
    hold: () => setHeldPrompt(currentPrompt),
  };
}
