import { useId } from "react";
import { ExternalLink } from "lucide-react";
import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import { CardCustomizerSurfaceWear } from "@/components/editor/CardCustomizerSurfaceWear";
import { CardCustomizerMaterials } from "@/components/editor/CardCustomizerMaterials";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  customizationFieldValue,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import { CARD_FINISH_PRESETS, CARD_FRAME_PRESETS, CARD_BORDER_PRESETS } from "@/lib/cardFinish";
import type { DeckCard } from "@/protocol/deck";

export function CardCustomizerControls({
  selected,
  drafts,
  disabled,
  retroCompatible,
  onChange,
}: {
  selected: readonly DeckCard[];
  drafts: ReadonlyMap<string, CardCustomizationDraft>;
  disabled: boolean;
  retroCompatible: boolean;
  onChange: (field: CosmeticField, value: string) => void;
}) {
  const labelId = useId();
  const inactive = disabled || selected.length === 0;
  const selectionKey = JSON.stringify(selected.map((copy) => copy.identity.id));
  const controls = [
    { field: "finish", label: "Finish", presets: CARD_FINISH_PRESETS },
    { field: "frame", label: "Frame", presets: CARD_FRAME_PRESETS },
    { field: "border", label: "Border", presets: CARD_BORDER_PRESETS },
    { field: "wearAmount", label: "Wear", presets: [] },
  ] as const;
  return (
    <section aria-label="Card appearance controls" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
        {controls.map(({ field, label, presets }) => {
          const value = customizationFieldValue(selected, drafts, field);
          return (
            <div key={field} className="min-w-0 space-y-1.5">
              <label id={`${labelId}-${field}`} className="block text-sm font-medium">
                {label}
              </label>
              {field !== "wearAmount" && (
                <AppSelect
                  value={value}
                  onValueChange={(next) => onChange(field, next)}
                  aria-labelledby={`${labelId}-${field}`}
                  disabled={inactive}
                  className="w-full"
                >
                  {value === "mixed" && (
                    <AppSelectOption value="mixed" disabled>
                      Mixed
                    </AppSelectOption>
                  )}
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
                    value={customizationFieldValue(selected, drafts, "rainFog")}
                    selectionKey={selectionKey}
                    min={0}
                    max={2}
                    disabled={inactive}
                    onChange={(next) => onChange("rainFog", next)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Zero clears the fog. Water distortion and reflections remain.
                  </p>
                </div>
              )}
              {field === "wearAmount" && (
                <CardCustomizerSurfaceWear
                  wear={value}
                  disabled={inactive}
                  onWearChange={(next) => onChange("wearAmount", next)}
                />
              )}
            </div>
          );
        })}
      </div>
      <CardCustomizerMaterials
        selected={selected}
        drafts={drafts}
        disabled={inactive}
        onChange={onChange}
      />
      <a
        href="/card-mock?tab=rendering"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-sm px-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Open Card lab
        <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
      </a>
    </section>
  );
}
