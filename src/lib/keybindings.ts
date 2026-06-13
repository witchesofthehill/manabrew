export interface KeyCombo {
  key: string;
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
];

export const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  const key = e.key.toLowerCase();
  if (key === "control" || key === "meta" || key === "alt" || key === "shift") return null;
  return { key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
}

export function combosMatch(a: KeyCombo, b: KeyCombo): boolean {
  return (
    a.key === b.key &&
    !!a.meta === !!b.meta &&
    !!a.ctrl === !!b.ctrl &&
    !!a.alt === !!b.alt &&
    !!a.shift === !!b.shift
  );
}

export function formatCombo(combo: KeyCombo): string {
  const mods: string[] = [];
  if (combo.ctrl) mods.push(IS_APPLE ? "⌃" : "Ctrl");
  if (combo.alt) mods.push(IS_APPLE ? "⌥" : "Alt");
  if (combo.shift) mods.push(IS_APPLE ? "⇧" : "Shift");
  if (combo.meta) mods.push(IS_APPLE ? "⌘" : "Super");
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  return [...mods, key].join(IS_APPLE ? " " : "+");
}
