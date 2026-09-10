import type { CSSProperties } from "react";
import type { InlineCardStyle, InGameCardPreviewStyle } from "@/stores/usePreferencesStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const IN_GAME_CARD_PREVIEW_STYLE_OPTIONS: ReadonlyArray<{
  value: InGameCardPreviewStyle;
  label: string;
}> = [
  {
    value: "printed",
    get label() {
      return i18n._(msg`Printed card`);
    },
  },
  {
    value: "rules",
    get label() {
      return i18n._(msg`Dynamic view`);
    },
  },
];
export const INLINE_CARD_STYLE_OPTIONS: ReadonlyArray<{
  value: InlineCardStyle;
  label: string;
}> = [
  {
    value: "printed",
    get label() {
      return i18n._(msg`Printed card`);
    },
  },
  {
    value: "rules",
    get label() {
      return i18n._(msg`Dynamic view`);
    },
  },
];
export const ACTIONABLE_CARD_GLOW_CLASS = "ring-2 transition-shadow duration-200" as const;
export function actionableCardGlowStyle(color: string): CSSProperties {
  return {
    "--tw-ring-color": color,
    boxShadow: `0 0 20px ${color}`,
  } as CSSProperties;
}
