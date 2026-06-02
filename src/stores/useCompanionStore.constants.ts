import type {
  CompanionAccentKey,
  CompanionCounterKind,
  CompanionLayout,
} from "./useCompanionStore.types";

export const COMPANION_MIN_PLAYERS = 2;
export const COMPANION_MAX_PLAYERS = 6;

export const COMPANION_DEFAULT_PLAYER_COUNT = 2;
export const COMPANION_DEFAULT_STARTING_LIFE = 20;
export const COMPANION_COMMANDER_STARTING_LIFE = 40;

export const COMPANION_HISTORY_LIMIT = 80;

/** Window during which successive life taps merge into one history entry. */
export const COMPANION_DELTA_BATCH_MS = 1400;

export const COMPANION_LETHAL_COMMANDER_DAMAGE = 21;

export const COMPANION_ACCENT_KEYS: readonly CompanionAccentKey[] = [
  "crimson",
  "azure",
  "emerald",
  "amber",
  "violet",
  "rose",
  "teal",
  "slate",
];

/**
 * Tile accent colors come from the active theme's `formatBadge` palette
 * (resolved into `--format-badge-*` CSS variables by `useTheme`). Each
 * accent key picks one slot of that palette so switching theme preset
 * recolors every tile in lock-step.
 */
export const COMPANION_ACCENT_COLORS: Record<CompanionAccentKey, string> = {
  crimson: "var(--format-badge-rose)",
  azure: "var(--format-badge-blue)",
  emerald: "var(--format-badge-emerald)",
  amber: "var(--format-badge-amber)",
  violet: "var(--format-badge-purple)",
  rose: "var(--format-badge-orange)",
  teal: "var(--format-badge-teal)",
  slate: "var(--format-badge-slate)",
};

export interface CounterPreset {
  kind: CompanionCounterKind;
  label: string;
  iconKey: string;
  defaultValue: number;
}

export const COMPANION_COUNTER_PRESETS: CounterPreset[] = [
  { kind: "poison", label: "Poison", iconKey: "skull-crack", defaultValue: 0 },
  { kind: "energy", label: "Energy", iconKey: "lightning-trio", defaultValue: 0 },
  { kind: "experience", label: "Experience", iconKey: "star-medal", defaultValue: 0 },
  { kind: "rad", label: "Radiation", iconKey: "radioactive", defaultValue: 0 },
  { kind: "tickets", label: "Tickets", iconKey: "trophy-cup", defaultValue: 0 },
  { kind: "storm", label: "Storm", iconKey: "tornado", defaultValue: 0 },
];

/** Game-icons keys offered in the custom-counter icon picker. */
export const COMPANION_CUSTOM_ICONS = [
  "star-medal",
  "bleeding-heart",
  "flame",
  "sands-of-time",
  "potion-ball",
  "sun-priest",
  "magic-portal",
  "crown",
  "sword",
  "crossed-swords",
  "spell-book",
  "fairy-wand",
  "skull-crack",
  "sparkles",
  "lightning-trio",
  "trophy-cup",
  "dragon-head",
  "vortex",
  "healing",
  "stormy-sea",
] as const;

export const COMPANION_DEFAULT_LAYOUT_BY_COUNT: Record<number, CompanionLayout> = {
  2: "1v1",
  3: "three-wedge",
  4: "four-sides",
  5: "five-radial",
  6: "six-grid",
};

export const COMPANION_LAYOUT_OPTIONS: Record<number, CompanionLayout[]> = {
  2: ["1v1", "two-side", "landscape-row", "vertical-stack", "free"],
  3: ["three-wedge", "pinwheel-3", "landscape-row", "vertical-stack", "free"],
  4: ["four-sides", "quad", "landscape-row", "vertical-stack", "free"],
  5: ["five-radial", "landscape-row", "vertical-stack", "free"],
  6: ["six-grid", "pinwheel-6", "landscape-row", "vertical-stack", "free"],
};

export const COMPANION_LAYOUT_LABELS: Record<CompanionLayout, string> = {
  "1v1": "Head-to-head",
  "two-side": "Side-by-side",
  "three-wedge": "Three wedge",
  "pinwheel-3": "Three pinwheel",
  quad: "Quad (2×2)",
  "four-sides": "Four sides",
  "five-radial": "Five radial",
  "six-grid": "Six grid",
  "pinwheel-6": "Six pinwheel",
  "landscape-row": "Landscape row",
  "vertical-stack": "Vertical stack",
  free: "Free position",
};

export const COMPANION_STARTING_LIFE_PRESETS = [20, 25, 30, 40, 60] as const;
