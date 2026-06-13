export interface KeyCombo {
  key: string;
  // Primary command modifier: Cmd on Apple, Ctrl elsewhere.
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
    id: "deck-editor-focus-filter",
    label: "Focus the card filter",
    category: "Deck editor",
    defaultCombo: { key: "f", mod: true },
  },
];

export const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// Resolve the platform-agnostic `mod` flag to a concrete modifier.
export function normalizeCombo(c: KeyCombo): KeyCombo {
  if (!c.mod) return c;
  return IS_APPLE ? { ...c, mod: undefined, meta: true } : { ...c, mod: undefined, ctrl: true };
}

export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const key = e.key.toLowerCase();
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
