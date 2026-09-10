import type { DevViewportPreset } from "@/stores/useGameDevStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export interface DevViewportOption {
  value: DevViewportPreset;
  label: string;
  width: number | null;
  height: number | null;
}
export const DEV_VIEWPORT_OPTIONS: readonly DevViewportOption[] = [
  {
    value: "native",
    get label() {
      return i18n._(msg`Current`);
    },
    width: null,
    height: null,
  },
  {
    value: "phone",
    get label() {
      return i18n._(msg`Phone`);
    },
    width: 844,
    height: 390,
  },
  {
    value: "tablet",
    get label() {
      return i18n._(msg`Tablet`);
    },
    width: 1024,
    height: 768,
  },
  {
    value: "desktop",
    get label() {
      return i18n._(msg`Desktop`);
    },
    width: 1280,
    height: 720,
  },
  {
    value: "ultrawide",
    get label() {
      return i18n._(msg`Ultrawide`);
    },
    width: 1440,
    height: 600,
  },
];
export function getDevViewportOption(preset: DevViewportPreset): DevViewportOption {
  return DEV_VIEWPORT_OPTIONS.find((option) => option.value === preset)!;
}
