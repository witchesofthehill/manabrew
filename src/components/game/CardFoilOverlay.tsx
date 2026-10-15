import { DEFAULT_CARD_FOIL_MODE } from "@/lib/cardFinish";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";

export function CardFoilOverlay({ enabled }: { enabled: boolean }) {
  const mode = useCardFinishPreview((state) => state.mode) ?? DEFAULT_CARD_FOIL_MODE;
  const animated = usePreferencesStore((state) => state.inGameAnimations);
  return enabled && mode !== "regular" ? (
    <span
      aria-hidden="true"
      className="card-foil-overlay"
      data-card-finish="simulated-foil"
      data-foil-mode={mode}
      data-foil-animated={animated}
    />
  ) : null;
}
