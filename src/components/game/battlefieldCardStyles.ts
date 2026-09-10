import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const BATTLEFIELD_CARD_STYLE_OPTIONS = [
  {
    value: "realistic",
    get label() {
      return i18n._(msg`Realistic`);
    },
  },
  {
    value: "art",
    get label() {
      return i18n._(msg`Art-forward`);
    },
  },
  {
    value: "frame",
    get label() {
      return i18n._(msg`Mini-frame`);
    },
  },
] as const satisfies ReadonlyArray<{
  value: BattlefieldCardStyle;
  label: string;
}>;
