import { useEffect } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CARD_FOIL_MODES, DEFAULT_CARD_FOIL_MODE, type CardFoilMode } from "@/lib/cardFinish";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";

export function CardFoilControls() {
  const { mode, foilAll, setMode, setFoilAll } = useCardFinishPreview();
  const selected = mode ?? DEFAULT_CARD_FOIL_MODE;
  useEffect(() => {
    useCardFinishPreview.getState().setFoilAll(true);
    return () => useCardFinishPreview.getState().reset();
  }, []);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Foil preview controls"
    >
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={foilAll}
          onChange={(event) => setFoilAll(event.target.checked)}
        />
        Foil lab cards
      </label>
      <AppSelect
        aria-label="Foil treatment"
        value={selected}
        onValueChange={(value) => setMode(value as CardFoilMode)}
      >
        {CARD_FOIL_MODES.map(({ id, label }) => (
          <AppSelectOption key={id} value={id}>
            {label}
          </AppSelectOption>
        ))}
      </AppSelect>
      <span className="text-xs text-muted-foreground">Lab only. Native foil.</span>
    </div>
  );
}
