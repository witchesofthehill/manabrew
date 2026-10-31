import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import {
  customizationFieldValue,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import { Checkbox } from "@/components/ui/checkbox";
import type { CardCosmetics } from "@/protocol/deck";

export function CardCustomizerMaterials({
  cosmetics,
  disabled,
  onChange,
}: {
  cosmetics: CardCosmetics | undefined;
  disabled: boolean;
  onChange: (field: CosmeticField, value: string) => void;
}) {
  const dots = customizationFieldValue(cosmetics, "printDotsAmount");
  const dotArtwork = customizationFieldValue(cosmetics, "printDotsArtwork");
  const controls = [
    { field: "cardstockAmount", label: "Coating", min: 0, max: 1, step: 0.01 },
    { field: "printDotsAmount", label: "Print dots", min: 0, max: 0.5, step: 0.01 },
    ...(Number(dots) > 0
      ? ([{ field: "printDotsInset", label: "Dot inset", min: 0, max: 0.2, step: 0.001 }] as const)
      : []),
  ] as const;
  return (
    <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
      {controls.map(({ field, label, min, max, step }) => (
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
      {Number(dots) > 0 && (
        <label className="touch:min-h-11 flex items-center gap-2 text-ui-label text-muted-foreground">
          <Checkbox
            checked={dotArtwork === "true"}
            disabled={disabled}
            onCheckedChange={(checked) => onChange("printDotsArtwork", String(checked === true))}
          />
          Include artwork in print dots
        </label>
      )}
    </div>
  );
}
