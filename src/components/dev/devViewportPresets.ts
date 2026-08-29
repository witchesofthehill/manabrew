import type { DevViewportPreset } from "@/stores/useGameDevStore";

export interface DevViewportOption {
  value: DevViewportPreset;
  label: string;
  width: number | null;
  height: number | null;
}

export const DEV_VIEWPORT_OPTIONS: readonly DevViewportOption[] = [
  { value: "native", label: "Current", width: null, height: null },
  { value: "phone", label: "Phone", width: 844, height: 390 },
  { value: "tablet", label: "Tablet", width: 1024, height: 768 },
  { value: "desktop", label: "Desktop", width: 1280, height: 720 },
  { value: "ultrawide", label: "Ultrawide", width: 1440, height: 600 },
];

export function getDevViewportOption(preset: DevViewportPreset): DevViewportOption {
  return DEV_VIEWPORT_OPTIONS.find((option) => option.value === preset)!;
}
