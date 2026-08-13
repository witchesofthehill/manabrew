export const DECK_EDITOR_WELCOME_EVENT = "manabrew:deck-editor-welcome";

export function openDeckEditorWelcome() {
  window.dispatchEvent(new Event(DECK_EDITOR_WELCOME_EVENT));
}
