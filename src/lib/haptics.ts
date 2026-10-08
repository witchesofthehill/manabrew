import { usePreferencesStore } from "@/stores/usePreferencesStore";

export type HapticPattern = "select" | "confirm" | "warn";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  select: 8,
  confirm: 16,
  warn: [12, 40, 12],
};

export function haptic(pattern: HapticPattern): void {
  if (!usePreferencesStore.getState().hapticFeedback) return;
  navigator.vibrate?.(PATTERNS[pattern]);
}
