import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export interface KeyCombo {
  key: string;
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}
export interface KeybindingDef {
  id: string;
  label: string;
  category: string;
  defaultCombo: KeyCombo;
  allowInEditable?: boolean;
}
export const KEYBINDINGS: KeybindingDef[] = [
  {
    id: "nav-prev-page",
    get label() {
      return i18n._(msg`Previous page`);
    },
    category: "Navigation",
    defaultCombo: { key: "arrowup", alt: true },
  },
  {
    id: "nav-next-page",
    get label() {
      return i18n._(msg`Next page`);
    },
    category: "Navigation",
    defaultCombo: { key: "arrowdown", alt: true },
  },
  {
    id: "go-back",
    get label() {
      return i18n._(msg`Go back`);
    },
    category: "Navigation",
    defaultCombo: { key: "arrowleft", alt: true },
  },
  {
    id: "deck-editor-focus-filter",
    get label() {
      return i18n._(msg`Focus the card filter`);
    },
    category: "Deck editor",
    defaultCombo: { key: "f", mod: true },
  },
  {
    id: "deck-editor-focus-quick-add",
    get label() {
      return i18n._(msg`Focus quick-add card`);
    },
    category: "Deck editor",
    defaultCombo: { key: "a", alt: true },
  },
  {
    id: "deck-editor-toggle-search",
    get label() {
      return i18n._(msg`Toggle card search`);
    },
    category: "Deck editor",
    defaultCombo: { key: "s", alt: true },
  },
  {
    id: "deck-editor-toggle-preview",
    get label() {
      return i18n._(msg`Toggle preview panel`);
    },
    category: "Deck editor",
    defaultCombo: { key: "p", alt: true },
  },
  {
    id: "deck-editor-save",
    get label() {
      return i18n._(msg`Save deck`);
    },
    category: "Deck editor",
    defaultCombo: { key: "s", mod: true },
  },
  {
    id: "deck-editor-export",
    get label() {
      return i18n._(msg`Export deck`);
    },
    category: "Deck editor",
    defaultCombo: { key: "e", mod: true },
  },
  {
    id: "deck-editor-undo",
    get label() {
      return i18n._(msg`Undo deck edit`);
    },
    category: "Deck editor",
    defaultCombo: { key: "z", mod: true },
  },
  {
    id: "deck-editor-redo",
    get label() {
      return i18n._(msg`Redo deck edit`);
    },
    category: "Deck editor",
    defaultCombo: { key: "z", mod: true, shift: true },
  },
  {
    id: "deck-editor-command-palette",
    get label() {
      return i18n._(msg`Open deck command palette`);
    },
    category: "Deck editor",
    defaultCombo: { key: "p", mod: true, shift: true },
    allowInEditable: true,
  },
  {
    id: "deck-editor-collapse-sections",
    get label() {
      return i18n._(msg`Collapse all deck sections`);
    },
    category: "Deck editor",
    defaultCombo: { key: "-", alt: true, shift: true },
  },
  {
    id: "deck-editor-expand-sections",
    get label() {
      return i18n._(msg`Expand all deck sections`);
    },
    category: "Deck editor",
    defaultCombo: { key: "=", alt: true, shift: true },
  },
  {
    id: "deck-editor-next-section",
    get label() {
      return i18n._(msg`Jump to next editor section`);
    },
    category: "Deck editor",
    defaultCombo: { key: "3", alt: true },
  },
  {
    id: "deck-editor-tag-selection",
    get label() {
      return i18n._(msg`Tag selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "t" },
  },
  {
    id: "deck-editor-select-all",
    get label() {
      return i18n._(msg`Select all deck cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "a", mod: true },
  },
  {
    id: "deck-editor-copy-selection",
    get label() {
      return i18n._(msg`Copy selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "c", mod: true },
  },
  {
    id: "deck-editor-paste-cards",
    get label() {
      return i18n._(msg`Paste cards into deck`);
    },
    category: "Deck editor",
    defaultCombo: { key: "v", mod: true },
  },
  {
    id: "deck-editor-remove-selection",
    get label() {
      return i18n._(msg`Remove selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "delete" },
  },
  {
    id: "deck-editor-move-main",
    get label() {
      return i18n._(msg`Move selected cards to main deck`);
    },
    category: "Deck editor",
    defaultCombo: { key: "m" },
  },
  {
    id: "deck-editor-move-side",
    get label() {
      return i18n._(msg`Move selected cards to sideboard`);
    },
    category: "Deck editor",
    defaultCombo: { key: "s" },
  },
  {
    id: "deck-editor-move-maybe",
    get label() {
      return i18n._(msg`Move selected cards to maybeboard`);
    },
    category: "Deck editor",
    defaultCombo: { key: "b" },
  },
  {
    id: "deck-editor-toggle-foil-selection",
    get label() {
      return i18n._(msg`Toggle foil for selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "f" },
  },
  {
    id: "deck-editor-remove-one-selection",
    get label() {
      return i18n._(msg`Remove one copy of selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "-" },
  },
  {
    id: "deck-editor-add-one-selection",
    get label() {
      return i18n._(msg`Add one copy of selected cards`);
    },
    category: "Deck editor",
    defaultCombo: { key: "=" },
  },
  {
    id: "open-settings",
    get label() {
      return i18n._(msg`Open preferences`);
    },
    category: "Navigation",
    defaultCombo: { key: ",", mod: true },
  },
  {
    id: "show-shortcuts",
    get label() {
      return i18n._(msg`Show keyboard shortcuts`);
    },
    category: "Help",
    defaultCombo: { key: "?", shift: true },
  },
  {
    id: "card-search-focus",
    get label() {
      return i18n._(msg`Focus search`);
    },
    category: "Card search",
    defaultCombo: { key: "/" },
  },
  {
    id: "flip-card",
    get label() {
      return i18n._(msg`Flip double-faced card (preview / hand)`);
    },
    category: "Game",
    defaultCombo: { key: "f" },
  },
  {
    id: "toggle-card-view",
    get label() {
      return i18n._(msg`Toggle card rules / printed view`);
    },
    category: "Game",
    defaultCombo: { key: "r" },
  },
  {
    id: "preview-prev-action",
    get label() {
      return i18n._(msg`Previous preview action`);
    },
    category: "Game",
    defaultCombo: { key: "arrowup" },
  },
  {
    id: "preview-next-action",
    get label() {
      return i18n._(msg`Next preview action`);
    },
    category: "Game",
    defaultCombo: { key: "arrowdown" },
  },
  {
    id: "preview-activate-action",
    get label() {
      return i18n._(msg`Activate focused preview action`);
    },
    category: "Game",
    defaultCombo: { key: "enter" },
  },
  {
    id: "preview-dismiss",
    get label() {
      return i18n._(msg`Close card preview`);
    },
    category: "Game",
    defaultCombo: { key: "escape" },
  },
  {
    id: "pass-priority",
    get label() {
      return i18n._(msg`Pass priority / confirm`);
    },
    category: "Battlefield",
    defaultCombo: { key: " " },
  },
  {
    id: "pass-end-of-turn",
    get label() {
      return i18n._(msg`Pass until end of turn / resolve stack`);
    },
    category: "Battlefield",
    defaultCombo: { key: " ", shift: true },
  },
  {
    id: "toggle-stack",
    get label() {
      return i18n._(msg`Collapse / expand the stack`);
    },
    category: "Battlefield",
    defaultCombo: { key: "s", mod: true },
  },
  {
    id: "toggle-priority-mode",
    get label() {
      return i18n._(msg`Toggle autopass / full control`);
    },
    category: "Battlefield",
    defaultCombo: { key: "tab" },
  },
  {
    id: "cycle-hand-order",
    get label() {
      return i18n._(msg`Cycle hand order`);
    },
    category: "Battlefield",
    defaultCombo: { key: "h", shift: true },
  },
  {
    id: "focus-next-field",
    get label() {
      return i18n._(msg`Focus next opponent field`);
    },
    category: "Battlefield",
    defaultCombo: { key: "]" },
  },
  {
    id: "focus-prev-field",
    get label() {
      return i18n._(msg`Focus previous opponent field`);
    },
    category: "Battlefield",
    defaultCombo: { key: "[" },
  },
  {
    id: "open-dev-panel",
    get label() {
      return i18n._(msg`Open the dev panel`);
    },
    category: "Battlefield",
    defaultCombo: { key: "d", mod: true, shift: true },
  },
  {
    id: "toggle-fullscreen",
    get label() {
      return i18n._(msg`Toggle fullscreen`);
    },
    category: "Battlefield",
    defaultCombo: { key: "f", mod: true },
  },
];
export const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
export function normalizeCombo(c: KeyCombo): KeyCombo {
  if (!c.mod) return c;
  return IS_APPLE ? { ...c, mod: undefined, meta: true } : { ...c, mod: undefined, ctrl: true };
}
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  // Derive the key from the physical `code` so it stays stable when Option/Alt
  // produces a different character on macOS (Option+P → "π").
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) {
    key = e.code.slice(3).toLowerCase();
  } else if (/^Digit[0-9]$/.test(e.code)) {
    key = e.code.slice(5);
  } else {
    key = e.key.toLowerCase();
  }
  if (key === "control" || key === "meta" || key === "alt" || key === "shift") return null;
  return { key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
}
export function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
  const na = normalizeCombo(a);
  const nb = normalizeCombo(b);
  return (
    na.key === nb.key &&
    !!na.meta === !!nb.meta &&
    !!na.ctrl === !!nb.ctrl &&
    !!na.alt === !!nb.alt &&
    !!na.shift === !!nb.shift
  );
}
const KEY_LABELS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  get " "() {
    return i18n._(msg`Space`);
  },
  get escape() {
    return i18n._(msg`Esc`);
  },
  enter: "↵",
};
function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}
const KEY_SYMBOLS: Record<string, string> = {
  " ": "␣",
  enter: "↵",
  tab: "⇥",
  escape: "⎋",
};
export function comboSymbols(combo: KeyCombo): string {
  const c = normalizeCombo(combo);
  const parts: string[] = [];
  if (c.ctrl) parts.push("⌃");
  if (c.alt) parts.push("⌥");
  if (c.shift) parts.push("⇧");
  if (c.meta) parts.push("⌘");
  parts.push(KEY_SYMBOLS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return parts.join("");
}
export function formatCombo(combo: KeyCombo): string {
  const c = normalizeCombo(combo);
  const mods: string[] = [];
  if (c.ctrl) mods.push(IS_APPLE ? "⌃" : "Ctrl");
  if (c.alt) mods.push(IS_APPLE ? "⌥" : "Alt");
  if (c.shift) mods.push(IS_APPLE ? "⇧" : "Shift");
  if (c.meta) mods.push(IS_APPLE ? "⌘" : "Super");
  return [...mods, keyLabel(c.key)].join(IS_APPLE ? " " : "+");
}
