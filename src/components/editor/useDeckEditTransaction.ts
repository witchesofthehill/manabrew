import { useCallback, useEffect, useRef } from "react";

import { useDeckStore } from "@/stores/useDeckStore";
import type { EditorDeck } from "@/types/manabrew";
import { captureDeckEditSnapshot, commitDeckEdit } from "./deckEditor.history";

export function useDeckEditTransaction(label: string) {
  const beforeRef = useRef<EditorDeck | null>(null);
  const sessionRef = useRef<string | null>(null);
  const begin = useCallback(() => {
    if (beforeRef.current) return;
    beforeRef.current = captureDeckEditSnapshot();
    sessionRef.current = useDeckStore.getState().editorSessionId;
  }, []);
  const commit = useCallback(() => {
    const before = beforeRef.current;
    const session = sessionRef.current;
    beforeRef.current = null;
    sessionRef.current = null;
    if (!before || session !== useDeckStore.getState().editorSessionId) return;
    commitDeckEdit(label, before);
  }, [label]);
  useEffect(() => () => commit(), [commit]);
  return { begin, commit };
}
