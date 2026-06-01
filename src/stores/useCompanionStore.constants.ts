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

/** OKLCH tile accents — tuned for legible white text overlay. */
export const COMPANION_ACCENT_COLORS: Record<CompanionAccentKey, string> = {
  crimson: "oklch(0.55 0.18 25)",
  azure: "oklch(0.55 0.16 240)",
  emerald: "oklch(0.55 0.15 155)",
  amber: "oklch(0.62 0.15 75)",
  violet: "oklch(0.52 0.18 295)",
  rose: "oklch(0.6 0.18 0)",
  teal: "oklch(0.55 0.13 195)",
  slate: "oklch(0.45 0.04 250)",
};

export interface CounterPreset {
  kind: CompanionCounterKind;
  label: string;
  iconKey: string;
  defaultValue: number;
}

export const COMPANION_COUNTER_PRESETS: CounterPreset[] = [
  { kind: "poison", label: "Poison", iconKey: "Skull", defaultValue: 0 },
  { kind: "energy", label: "Energy", iconKey: "Zap", defaultValue: 0 },
  { kind: "experience", label: "Experience", iconKey: "Sparkles", defaultValue: 0 },
  { kind: "rad", label: "Radiation", iconKey: "Radiation", defaultValue: 0 },
  { kind: "tickets", label: "Tickets", iconKey: "Ticket", defaultValue: 0 },
  { kind: "storm", label: "Storm", iconKey: "CloudLightning", defaultValue: 0 },
];

/** Lucide icon name → human label for custom-counter icon picker. */
export const COMPANION_CUSTOM_ICONS = [
  "Star",
  "Heart",
  "Flame",
  "Snowflake",
  "Droplets",
  "Sun",
  "Moon",
  "Crown",
  "Sword",
  "Shield",
  "Hourglass",
  "Bug",
  "Skull",
  "Sparkles",
  "Zap",
  "Trophy",
  "Anchor",
  "Compass",
  "Feather",
  "Gem",
] as const;

export const COMPANION_DEFAULT_LAYOUT_BY_COUNT: Record<number, CompanionLayout> = {
  2: "1v1",
  3: "three-wedge",
  4: "quad",
  5: "five-radial",
  6: "six-grid",
};

export const COMPANION_LAYOUT_OPTIONS: Record<number, CompanionLayout[]> = {
  2: ["1v1", "two-side", "free"],
  3: ["three-wedge", "free"],
  4: ["quad", "free"],
  5: ["five-radial", "free"],
  6: ["six-grid", "free"],
};

export const COMPANION_LAYOUT_LABELS: Record<CompanionLayout, string> = {
  "1v1": "Head-to-head",
  "two-side": "Side-by-side",
  "three-wedge": "Three wedge",
  quad: "Quad (2×2)",
  "five-radial": "Five radial",
  "six-grid": "Six grid",
  free: "Free position",
};

export const COMPANION_STARTING_LIFE_PRESETS = [20, 25, 30, 40, 60] as const;
