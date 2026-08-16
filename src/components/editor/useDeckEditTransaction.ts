import { useCallback, useRef } from "react";

import type { EditorDeck } from "@/types/manabrew";
import { captureDeckEditSnapshot, commitDeckEdit } from "./deckEditor.history";

export function useDeckEditTransaction(label: string) {
  const beforeRef = useRef<EditorDeck | null>(null);
  const begin = useCallback(() => {
    beforeRef.current ??= captureDeckEditSnapshot();
  }, []);
  const commit = useCallback(() => {
    if (!beforeRef.current) return;
    commitDeckEdit(label, beforeRef.current);
    beforeRef.current = null;
  }, [label]);
  return { begin, commit };
}
