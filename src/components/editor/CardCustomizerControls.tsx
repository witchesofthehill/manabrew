import { useId } from "react";
import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import { CardCustomizerSurfaceWear } from "@/components/editor/CardCustomizerSurfaceWear";
import { CardCustomizerMaterials } from "@/components/editor/CardCustomizerMaterials";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { isFeatureEnabled } from "@/featureFlags";
import {
  customizationFieldValue,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import { CARD_FINISH_PRESETS, CARD_FRAME_PRESETS, CARD_BORDER_PRESETS } from "@/lib/cardFinish";
import type { CardCosmetics } from "@/protocol/deck";

export function CardCustomizerControls({
  cosmetics,
  disabled,
  retroCompatible,
  onChange,
}: {
  cosmetics: CardCosmetics | undefined;
  disabled: boolean;
  retroCompatible: boolean;
  onChange: (field: CosmeticField, value: string) => void;
}) {
  const labelId = useId();
  const finishDisabled = disabled || !isFeatureEnabled("cardFoil");
  const controls = [
    { field: "finish", label: "Finish", presets: CARD_FINISH_PRESETS },
    { field: "frame", label: "Frame", presets: CARD_FRAME_PRESETS },
    { field: "border", label: "Border", presets: CARD_BORDER_PRESETS },
    { field: "wearAmount", label: "Wear", presets: [] },
  ] as const;
  return (
    <section aria-label="Card appearance controls" className="space-y-2">
      <div className="grid gap-3 lg:grid-cols-2">
        {controls.map(({ field, label, presets }) => {
          const value = customizationFieldValue(cosmetics, field);
          return (
            <div key={field} className="min-w-0 space-y-1.5">
              <label
                id={`${labelId}-${field}`}
                className="touch:min-h-11 block text-ui-label font-medium"
              >
                {label}
              </label>
              {field !== "wearAmount" && (
                <AppSelect
                  value={value}
                  onValueChange={(next) => onChange(field, next)}
                  aria-labelledby={`${labelId}-${field}`}
                  disabled={field === "finish" ? finishDisabled : disabled}
                  className="touch:min-h-11 w-full"
                >
                  {field === "finish" && (
                    <AppSelectOption value="printing">Printing default</AppSelectOption>
                  )}
                  {presets.map(({ id, label: presetLabel }) => (
                    <AppSelectOption
                      key={id}
                      value={id}
                      disabled={field === "frame" && id === "retro" && !retroCompatible}
                    >
                      {presetLabel}
                    </AppSelectOption>
                  ))}
                </AppSelect>
              )}
              {field === "finish" && value === "rain" && (
                <div className="space-y-1.5 pt-1">
                  <CardCustomizerNumber
                    label="Rain fog"
                    value={customizationFieldValue(cosmetics, "rainFog")}
                    min={0}
                    max={2}
                    disabled={finishDisabled}
                    onChange={(next) => onChange("rainFog", next)}
                  />
                  <p className="text-ui-body text-muted-foreground">
                    Zero clears the fog. Water distortion and reflections remain.
                  </p>
                </div>
              )}
              {field === "finish" && value === "heat" && (
                <CardCustomizerNumber
                  label="Heat deformation"
                  value={customizationFieldValue(cosmetics, "heatDeformation")}
                  min={0}
                  max={0.02}
                  step={0.0001}
                  disabled={finishDisabled}
                  onChange={(next) => onChange("heatDeformation", next)}
                />
              )}
              {field === "wearAmount" && (
                <CardCustomizerSurfaceWear
                  wear={value}
                  disabled={finishDisabled}
                  onWearChange={(next) => onChange("wearAmount", next)}
                />
              )}
            </div>
          );
        })}
      </div>
      <CardCustomizerMaterials
        cosmetics={cosmetics}
        disabled={finishDisabled}
        onChange={onChange}
      />
    </section>
  );
}
