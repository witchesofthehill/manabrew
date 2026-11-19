import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import {
  customizationFieldValue,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import type { CardCosmetics } from "@/protocol/deck";

const CONTROLS = [
  { field: "cardstockAmount", label: "Coating", min: 0, max: 1, step: 0.01 },
  { field: "printDotsAmount", label: "Print dots", min: 0, max: 0.5, step: 0.01 },
] as const;

export function CardCustomizerMaterials({
  cosmetics,
  disabled,
  onChange,
}: {
  cosmetics: CardCosmetics | undefined;
  disabled: boolean;
  onChange: (field: CosmeticField, value: string) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {CONTROLS.map(({ field, label, min, max, step }) => (
        <CardCustomizerNumber
          key={field}
          label={label}
          value={customizationFieldValue(cosmetics, field)}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(next) => onChange(field, next)}
        />
      ))}
    </div>
  );
}
