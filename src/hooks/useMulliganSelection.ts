import { useCallback, useState } from "react";
import type { Prompt } from "@/protocol";

export interface MulliganSelection {
  active: boolean;
  count: number;
  selected: Set<string>;
  toggle: (cardId: string) => void;
  confirm: () => void;
}

export function useMulliganSelection(
  activePrompt: Prompt | null,
  putBackDecision: (cardIds: string[]) => void,
): MulliganSelection {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const promptCount = activePrompt?.input.type === "mulliganPutBack" ? activePrompt.input.count : 0;

  const promptKey = `${activePrompt?.input.type ?? ""}:${promptCount}`;
  const [prevPromptKey, setPrevPromptKey] = useState(promptKey);
  if (prevPromptKey !== promptKey) {
    setPrevPromptKey(promptKey);
    setSelected(new Set());
  }

  const toggle = useCallback(
    (cardId: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cardId)) {
          next.delete(cardId);
        } else if (next.size < promptCount) {
          next.add(cardId);
        }
        return next;
      });
    },
    [promptCount],
  );

  const confirm = useCallback(() => {
    if (selected.size !== promptCount) return;
    putBackDecision([...selected]);
  }, [selected, promptCount, putBackDecision]);

  return {
    active: activePrompt?.input.type === "mulliganPutBack",
    count: promptCount,
    selected,
    toggle,
    confirm,
  };
}
