import type {
  CompanionAccentKey,
  CompanionCounterKind,
  CompanionLayout,
} from "./useCompanionStore.types";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const COMPANION_MIN_PLAYERS = 2;
export const COMPANION_MAX_PLAYERS = 6;
export const COMPANION_DEFAULT_PLAYER_COUNT = 2;
export const COMPANION_DEFAULT_STARTING_LIFE = 20;
export const COMPANION_COMMANDER_STARTING_LIFE = 40;
export const COMPANION_HISTORY_LIMIT = 80;
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
  {
    kind: "poison",
    get label() {
      return i18n._(msg`Poison`);
    },
    iconKey: "skull-crack",
    defaultValue: 0,
  },
  {
    kind: "energy",
    get label() {
      return i18n._(msg`Energy`);
    },
    iconKey: "lightning-trio",
    defaultValue: 0,
  },
  {
    kind: "experience",
    get label() {
      return i18n._(msg`Experience`);
    },
    iconKey: "star-medal",
    defaultValue: 0,
  },
  {
    kind: "rad",
    get label() {
      return i18n._(msg`Radiation`);
    },
    iconKey: "radioactive",
    defaultValue: 0,
  },
  {
    kind: "tickets",
    get label() {
      return i18n._(msg`Tickets`);
    },
    iconKey: "trophy-cup",
    defaultValue: 0,
  },
  {
    kind: "storm",
    get label() {
      return i18n._(msg`Storm`);
    },
    iconKey: "tornado",
    defaultValue: 0,
  },
];
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
  4: "quad",
  5: "five-radial",
  6: "six-grid",
};
export const COMPANION_LAYOUT_OPTIONS: Record<number, CompanionLayout[]> = {
  2: ["1v1", "two-side", "two-across", "landscape-row", "vertical-stack", "free"],
  3: ["three-wedge", "three-sides", "pinwheel-3", "landscape-row", "vertical-stack", "free"],
  4: ["quad", "four-sides", "landscape-row", "vertical-stack", "free"],
  5: ["five-radial", "five-rows", "landscape-row", "vertical-stack", "free"],
  6: ["six-grid", "six-sides", "pinwheel-6", "landscape-row", "vertical-stack", "free"],
};
export const COMPANION_LAYOUT_LABELS: Record<CompanionLayout, string> = {
  get "1v1"() {
    return i18n._(msg`Head-to-head`);
  },
  get "two-side"() {
    return i18n._(msg`Side-by-side`);
  },
  get "two-across"() {
    return i18n._(msg`Two across`);
  },
  get "three-wedge"() {
    return i18n._(msg`Three wedge`);
  },
  get "three-sides"() {
    return i18n._(msg`Three sides`);
  },
  get "pinwheel-3"() {
    return i18n._(msg`Three pinwheel`);
  },
  get quad() {
    return i18n._(msg`Quad (2\u00D72)`);
  },
  get "four-sides"() {
    return i18n._(msg`Four sides`);
  },
  get "five-radial"() {
    return i18n._(msg`Five radial`);
  },
  get "five-rows"() {
    return i18n._(msg`Five rows`);
  },
  get "six-grid"() {
    return i18n._(msg`Six grid`);
  },
  get "six-sides"() {
    return i18n._(msg`Six sides`);
  },
  get "pinwheel-6"() {
    return i18n._(msg`Six pinwheel`);
  },
  get "landscape-row"() {
    return i18n._(msg`Landscape row`);
  },
  get "vertical-stack"() {
    return i18n._(msg`Vertical stack`);
  },
  get free() {
    return i18n._(msg`Free position`);
  },
};
export const COMPANION_STARTING_LIFE_PRESETS = [20, 25, 30, 40, 60] as const;
