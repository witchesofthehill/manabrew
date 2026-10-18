import { useEffect, useRef, useSyncExternalStore } from "react";
import { hasCardFinishEffects, resolveCardFinish, type CardFoilRegion } from "@/lib/cardFinish";
import type { CardCosmetics } from "@/protocol/deck";
import {
  registerDomCardFoil,
  type CardFoilSource,
  type DomCardFoilOptions,
  type DomCardFoilRegistration,
} from "@/lib/cardFoilDom";
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
  const visible = enabled && hasCardFinishEffects(mode, cosmetics);
  const optionsRef = useRef<DomCardFoilOptions>({
    source,
    artWindows,
    mode,
    cosmetics,
    animated,
  });
  const registrationRef = useRef<DomCardFoilRegistration | null>(null);
  useEffect(() => {
    const options = { source, artWindows, mode, cosmetics, animated };
    optionsRef.current = options;
    registrationRef.current?.update(options);
  }, [source, artWindows, mode, cosmetics, animated]);
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const registration = registerDomCardFoil(canvasRef.current, optionsRef.current);
    registrationRef.current = registration;
    return () => {
      registrationRef.current = null;
      registration.dispose();
    };
  }, [visible]);
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
