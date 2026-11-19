import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useKeybindingsStore, resolveCombo } from "@/stores/useKeybindingsStore";
import {
  KEYBINDINGS,
  comboFromEvent,
  combosMatch,
  hasActiveVirtualTextInput,
} from "@/lib/keybindings";
import { topModal } from "@/lib/modalStack";
import { registerEscapeHandler } from "@/lib/escapeKey";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

const NATIVE_CONTROL_KEYS: Record<string, true> = {
  " ": true,
  enter: true,
  arrowup: true,
  arrowdown: true,
  arrowleft: true,
  arrowright: true,
  home: true,
  end: true,
};

function preservesNativeInteraction(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if (!NATIVE_CONTROL_KEYS[event.key.toLowerCase()]) return false;
  if (!(event.target instanceof HTMLElement)) return false;
  return !!event.target.closest(
    'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
  );
}

export function useKeybindings(
  handlers: Record<string, () => boolean | void>,
  scope?: RefObject<HTMLElement | null>,
) {
  const overrides = useKeybindingsStore((s) => s.overrides);
  const handlersRef = useRef(handlers);

  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    function dispatch(e: KeyboardEvent, previewsOnly?: boolean): boolean {
      if (e.defaultPrevented || e.isComposing || hasActiveVirtualTextInput()) return false;
      if (preservesNativeInteraction(e)) return false;
      const editableTarget = isEditableTarget(e.target);
      const pressed = comboFromEvent(e);
      if (!pressed) return false;
      for (const def of KEYBINDINGS) {
        if (previewsOnly !== undefined && (def.id === "preview-dismiss") !== previewsOnly) continue;
        const handler = handlersRef.current[def.id];
        if (!handler) continue;
        const modal = topModal();
        if (
          modal &&
          def.id !== "show-shortcuts" &&
          (!scope?.current || !modal.contains(scope.current))
        )
          continue;
        if (editableTarget && !def.allowInEditable) continue;
        const combo = resolveCombo(def.id, overrides);
        if (combo && combosMatch(pressed, combo)) {
          if (def.id === "preview-dismiss" && e.repeat) return true;
          if (handler() === false) continue;
          return true;
        }
      }
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" || !dispatch(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    const unregisterPreview = registerEscapeHandler({
      priority: "preview",
      scope: () => scope?.current,
      handle: (event) => dispatch(event, true),
    });
    const unregisterShortcut = registerEscapeHandler({
      priority: "shortcut",
      scope: () => scope?.current,
      handle: (event) => dispatch(event, false),
    });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      unregisterPreview();
      unregisterShortcut();
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [overrides, scope]);
}
