import type { InGameCardPreviewStyle } from "@/stores/usePreferencesStore";

export const IN_GAME_CARD_PREVIEW_STYLE_OPTIONS: ReadonlyArray<{
  value: InGameCardPreviewStyle;
  label: string;
}> = [
  { value: "printed", label: "Printed card" },
  { value: "rules", label: "Rules view" },
];
