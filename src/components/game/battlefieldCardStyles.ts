import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";
export const BATTLEFIELD_CARD_STYLE_OPTIONS = [
  {
    value: "realistic",
    label: `Realistic`,
  },
  {
    value: "art",
    label: `Art-forward`,
  },
  {
    value: "frame",
    label: `Manabrew`,
  },
] as const satisfies ReadonlyArray<{
  value: BattlefieldCardStyle;
  label: string;
}>;
