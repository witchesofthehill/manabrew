import { useEffect } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CARD_FINISH_PRESETS, DEFAULT_CARD_FINISH } from "@/lib/cardFinish";
import type { CardFinish } from "@/protocol/deck";
import { useCardFinishPreview } from "@/stores/useCardFinishPreview";

export function CardFoilControls() {
  const { mode, foilAll, setMode, setFoilAll } = useCardFinishPreview();
  const selected = mode ?? DEFAULT_CARD_FINISH;
  useEffect(() => {
    useCardFinishPreview.getState().setFoilAll(true);
    return () => useCardFinishPreview.getState().reset();
  }, []);
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Card finish preview controls"
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
        aria-label="Card finish"
        value={selected}
        onValueChange={(value) => setMode(value as CardFinish)}
      >
        {CARD_FINISH_PRESETS.map(({ id, label }) => (
          <AppSelectOption key={id} value={id}>
            {label}
          </AppSelectOption>
        ))}
      </AppSelect>
      <span className="text-xs text-muted-foreground">Lab only. Card Glint finishes.</span>
    </div>
  );
}
