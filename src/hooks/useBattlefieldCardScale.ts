import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function useBattlefieldCardScale() {
  const fraction = usePreferencesStore((s) => s.battlefieldCardScale);
  const setFraction = usePreferencesStore((s) => s.setBattlefieldCardScale);
  return { fraction, setFraction };
}
