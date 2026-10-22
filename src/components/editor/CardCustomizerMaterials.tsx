import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import {
  customizationFieldValue,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import { Checkbox } from "@/components/ui/checkbox";
import type { DeckCard } from "@/protocol/deck";

export function CardCustomizerMaterials({
  selected,
  drafts,
  disabled,
  onChange,
}: {
  selected: readonly DeckCard[];
  drafts: ReadonlyMap<string, CardCustomizationDraft>;
  disabled: boolean;
  onChange: (field: CosmeticField, value: string) => void;
}) {
  const selectionKey = JSON.stringify(selected.map((copy) => copy.identity.id));
  const dots = customizationFieldValue(selected, drafts, "printDotsAmount");
  const dotArtwork = customizationFieldValue(selected, drafts, "printDotsArtwork");
  const controls = [
    { field: "cardstockAmount", label: "Coating", min: 0, max: 1, step: 0.01 },
    { field: "printDotsAmount", label: "Print dots", min: 0, max: 0.5, step: 0.01 },
    ...(dots === "mixed" || Number(dots) > 0
      ? ([{ field: "printDotsInset", label: "Dot inset", min: 0, max: 0.2, step: 0.001 }] as const)
      : []),
  ] as const;
  return (
    <div className="space-y-3 border-t pt-3">
      {controls.map(({ field, label, min, max, step }) => (
        <CardCustomizerNumber
          key={field}
          label={label}
          value={customizationFieldValue(selected, drafts, field)}
          selectionKey={selectionKey}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(next) => onChange(field, next)}
        />
      ))}
      {(dots === "mixed" || Number(dots) > 0) && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={dotArtwork === "mixed" ? "indeterminate" : dotArtwork === "true"}
            disabled={disabled}
            onCheckedChange={(checked) => onChange("printDotsArtwork", String(checked === true))}
          />
          Include artwork in print dots{dotArtwork === "mixed" ? " (mixed)" : ""}
        </label>
      )}
    </div>
  );
}
