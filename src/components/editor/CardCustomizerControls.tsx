import { useId } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  customizationFieldValue,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import {
  CARD_FINISH_PRESETS,
  CARD_FRAME_PRESETS,
  CARD_BORDER_PRESETS,
  CARD_WEAR_PRESETS,
} from "@/lib/cardFinish";
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
  const controls = [
    { field: "finish", label: "Finish", presets: CARD_FINISH_PRESETS },
    { field: "frame", label: "Frame", presets: CARD_FRAME_PRESETS },
    { field: "border", label: "Border", presets: CARD_BORDER_PRESETS },
    { field: "wear", label: "Wear", presets: CARD_WEAR_PRESETS },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
      {controls.map(({ field, label, presets }) => {
        const value = customizationFieldValue(selected, drafts, field);
        return (
          <div key={field} className="min-w-0 space-y-1.5">
            <label id={`${labelId}-${field}`} className="block text-sm font-medium">
              {label}
            </label>
            <AppSelect
              value={value}
              onValueChange={(next) => onChange(field, next)}
              aria-labelledby={`${labelId}-${field}`}
              disabled={disabled || selected.length === 0}
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
          </div>
        );
      })}
    </div>
  );
}
