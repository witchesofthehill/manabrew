import { topModal } from "@/lib/modalStack";

const PRIORITY = { selection: 0, shortcut: 1, prompt: 2, modal: 3, preview: 4 } as const;

interface EscapeHandler {
  handle: (event: KeyboardEvent) => boolean;
  priority: keyof typeof PRIORITY;
  scope?: () => HTMLElement | null | undefined;
}

const handlers: EscapeHandler[] = [];

function suppressRepeat(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !event.repeat || event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  const modal = topModal();
  for (const handler of handlers) {
    const scope = handler.scope?.();
    if (modal && (!scope || !modal.contains(scope))) continue;
    if (!handler.handle(event)) continue;
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
}

export function registerEscapeHandler(handler: EscapeHandler): () => void {
  if (handlers.length === 0) {
    window.addEventListener("keydown", suppressRepeat, true);
    window.addEventListener("keydown", handleEscape);
  }
  const index = handlers.findIndex(
    (entry) => PRIORITY[entry.priority] <= PRIORITY[handler.priority],
  );
  handlers.splice(index < 0 ? handlers.length : index, 0, handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
    if (handlers.length === 0) {
      window.removeEventListener("keydown", suppressRepeat, true);
      window.removeEventListener("keydown", handleEscape);
    }
  };
}
