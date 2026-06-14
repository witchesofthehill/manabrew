import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useBattlefieldScaleStore } from "@/stores/useBattlefieldScaleStore";
import { battlefieldScaleForFraction } from "@/pixi/GridLayout";
import { BATTLEFIELD_CARD_SCALE_DEFAULT } from "@/pixi/constants";

export function useBattlefieldCardScale() {
  const fraction = usePreferencesStore((s) => s.battlefieldCardScale);
  const setFraction = usePreferencesStore((s) => s.setBattlefieldCardScale);
  return { fraction, setFraction };
}

export function useResolvedBattlefieldScale(): number {
  const fraction = usePreferencesStore((s) => s.battlefieldCardScale);
  const usableHeights = useBattlefieldScaleStore((s) => s.usableHeights);
  const heights = Object.values(usableHeights);
  if (heights.length === 0) return BATTLEFIELD_CARD_SCALE_DEFAULT;
  return battlefieldScaleForFraction(Math.min(...heights), fraction);
}
