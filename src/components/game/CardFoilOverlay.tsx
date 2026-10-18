import { useEffect, useRef, useSyncExternalStore } from "react";
import { resolveCardFinish, resolveCardWearAmount, type CardFoilRegion } from "@/lib/cardFinish";
import type { CardCosmetics } from "@/protocol/deck";
import { registerDomCardFoil, type CardFoilSource } from "@/lib/cardFoilDom";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const subscribeMotion = (notify: () => void) => {
  reducedMotion.addEventListener("change", notify);
  return () => reducedMotion.removeEventListener("change", notify);
};
const motionSnapshot = () => reducedMotion.matches;

interface CardFoilOverlayProps {
  enabled: boolean;
  foil?: boolean;
  cosmetics?: CardCosmetics;
  etched?: boolean;
  source?: CardFoilSource | null;
  artWindows?: readonly CardFoilRegion[];
}

export function CardFoilOverlay({
  enabled,
  foil = false,
  cosmetics,
  etched = false,
  source,
  artWindows,
}: CardFoilOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mode =
    useCardFinishPreview((state) => state.mode) ?? resolveCardFinish(foil, cosmetics, etched);
  const animations = usePreferencesStore((state) => state.inGameAnimations);
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot);
  const animated = animations && !reduced;
  const visible = enabled && (mode !== "regular" || resolveCardWearAmount(cosmetics) > 0);
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    return registerDomCardFoil(canvasRef.current, {
      source,
      artWindows,
      mode,
      cosmetics,
      animated,
    });
  }, [visible, source, artWindows, mode, cosmetics, animated]);
  return visible ? (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="card-foil-overlay"
      data-card-finish="card-glint"
      data-foil-mode={mode}
      data-foil-animated={animated}
    />
  ) : null;
}
