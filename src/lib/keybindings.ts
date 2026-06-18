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
}

export const KEYBINDINGS: KeybindingDef[] = [
  {
    id: "toggle-sidebar",
    label: "Toggle navigation sidebar",
    category: "Navigation",
    defaultCombo: { key: "b", meta: true },
  },
  {
    id: "nav-prev-page",
    label: "Previous page",
    category: "Navigation",
    defaultCombo: { key: "arrowup", alt: true },
  },
  {
    id: "nav-next-page",
    label: "Next page",
    category: "Navigation",
    defaultCombo: { key: "arrowdown", alt: true },
  },
  {
    id: "go-back",
    label: "Go back",
    category: "Navigation",
    defaultCombo: { key: "arrowleft", alt: true },
  },
  {
    id: "deck-editor-focus-filter",
    label: "Focus the card filter",
    category: "Deck editor",
    defaultCombo: { key: "f", mod: true },
  },
  {
    id: "deck-editor-focus-quick-add",
    label: "Focus quick-add card",
    category: "Deck editor",
    defaultCombo: { key: "a", alt: true },
  },
  {
    id: "deck-editor-toggle-search",
    label: "Toggle card search",
    category: "Deck editor",
    defaultCombo: { key: "s", alt: true },
  },
  {
    id: "deck-editor-toggle-preview",
    label: "Toggle preview panel",
    category: "Deck editor",
    defaultCombo: { key: "p", alt: true },
  },
  {
    id: "deck-editor-save",
    label: "Save deck",
    category: "Deck editor",
    defaultCombo: { key: "s", mod: true },
  },
  {
    id: "deck-editor-export",
    label: "Export deck",
    category: "Deck editor",
    defaultCombo: { key: "e", mod: true },
  },
  {
    id: "open-settings",
    label: "Open preferences",
    category: "Navigation",
    defaultCombo: { key: ",", mod: true },
  },
  {
    id: "show-shortcuts",
    label: "Show keyboard shortcuts",
    category: "Help",
    defaultCombo: { key: "?", shift: true },
  },
  {
    id: "card-search-focus",
    label: "Focus search",
    category: "Card search",
    defaultCombo: { key: "/" },
  },
  {
    id: "flip-card",
    label: "Flip double-faced card (preview / hand)",
    category: "Game",
    defaultCombo: { key: "f" },
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
  " ": "Space",
  escape: "Esc",
  enter: "↵",
};

function keyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
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
