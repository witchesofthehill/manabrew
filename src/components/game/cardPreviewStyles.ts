import type { CSSProperties } from "react";
import type {
  InlineCardStyle,
  InGameCardPreviewSize,
  InGameCardPreviewStyle,
} from "@/stores/usePreferencesStore";
export const IN_GAME_CARD_PREVIEW_STYLE_OPTIONS: ReadonlyArray<{
  value: InGameCardPreviewStyle;
  label: string;
}> = [
  {
    value: "printed",
    label: `Realistic`,
  },
  {
    value: "rules",
    label: `Rules`,
  },
];
export const IN_GAME_CARD_PREVIEW_SIZE_OPTIONS: ReadonlyArray<{
  value: InGameCardPreviewSize;
  label: string;
}> = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
export const INLINE_CARD_STYLE_OPTIONS: ReadonlyArray<{
  value: InlineCardStyle;
  label: string;
}> = [
  {
    value: "printed",
    label: `Realistic`,
  },
  {
    value: "rules",
    label: `Rules`,
  },
];
export const ACTIONABLE_CARD_GLOW_CLASS = "ring-2 transition-shadow duration-200" as const;
export function actionableCardGlowStyle(color: string): CSSProperties {
  return {
    "--tw-ring-color": color,
    boxShadow: `0 0 20px ${color}`,
  } as CSSProperties;
}
