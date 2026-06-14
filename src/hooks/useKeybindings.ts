import { useEffect, useRef } from "react";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import { KEYBINDINGS, comboFromEvent, combosMatch } from "@/lib/keybindings";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function useKeybindings(handlers: Record<string, () => void>) {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const pressed = comboFromEvent(e);
      if (!pressed) return;
      for (const def of KEYBINDINGS) {
        const handler = handlersRef.current[def.id];
        if (!handler) continue;
        const combo = resolveCombo(def.id, overrides);
        if (combo && combosMatch(pressed, combo)) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [overrides]);
}
