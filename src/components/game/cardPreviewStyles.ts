import type { CSSProperties } from "react";
import type { HandCardStyle, InGameCardPreviewStyle } from "@/stores/usePreferencesStore";

export const IN_GAME_CARD_PREVIEW_STYLE_OPTIONS: ReadonlyArray<{
  value: InGameCardPreviewStyle;
  label: string;
}> = [
  { value: "printed", label: "Printed card" },
  { value: "rules", label: "Rules view" },
];

export const HAND_CARD_STYLE_OPTIONS: ReadonlyArray<{
  value: HandCardStyle;
  label: string;
}> = [
  { value: "printed", label: "Printed card" },
  { value: "rules", label: "Rules view" },
];

export const ACTIONABLE_CARD_GLOW_CLASS = "ring-2 transition-shadow duration-200" as const;

export function actionableCardGlowStyle(color: string): CSSProperties {
  return {
    "--tw-ring-color": color,
    boxShadow: `0 0 20px ${color}`,
  } as CSSProperties;
}
