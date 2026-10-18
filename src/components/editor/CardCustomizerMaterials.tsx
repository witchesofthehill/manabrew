import { useId } from "react";
import { CardCustomizerNumber } from "@/components/editor/CardCustomizerNumber";
import {
  customizationFieldValue,
  type CardCustomizationDraft,
  type CosmeticField,
} from "@/components/editor/cardCustomizerDraft";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
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
  const coverageId = useId();
  const selectionKey = JSON.stringify(selected.map((copy) => copy.identity.id));
  const dots = customizationFieldValue(selected, drafts, "printDotsAmount");
  const coverage = customizationFieldValue(selected, drafts, "finishCoverageArea");
  const explicitCoverage =
    selected.length > 0 &&
    selected.every((copy) => {
      const draft = drafts.get(copy.identity.id);
      return !!(draft ? draft.cosmetics : copy.identity.cosmetics)?.finishCoverage;
    });
  const controls = [
    { field: "cardstockAmount", label: "Coating", min: 0, max: 1, step: 0.01 },
    { field: "printDotsAmount", label: "Print dots", min: 0, max: 1, step: 0.01 },
    ...(dots === "mixed" || Number(dots) > 0
      ? ([
          {
            field: "printDotsPeriod",
            label: "Dot period (source pixels)",
            min: 2,
            max: 16,
            step: 0.1,
          },
          { field: "printDotsVariation", label: "Dot variation", min: 0, max: 1, step: 0.01 },
          { field: "printDotsInset", label: "Dot inset", min: 0, max: 0.2, step: 0.001 },
        ] as const)
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
      <div className="space-y-1.5">
        <label id={coverageId} className="block text-xs text-muted-foreground">
          Finish coverage
        </label>
        <AppSelect
          value={coverage}
          onValueChange={(next) => onChange("finishCoverageArea", next)}
          aria-labelledby={coverageId}
          disabled={disabled}
          className="w-full"
        >
          {coverage === "mixed" && (
            <AppSelectOption value="mixed" disabled>
              Mixed
            </AppSelectOption>
          )}
          <AppSelectOption value="native">Native printing</AppSelectOption>
          <AppSelectOption value="full">Full card</AppSelectOption>
          <AppSelectOption value="artwork">Artwork</AppSelectOption>
          <AppSelectOption value="left">Left half</AppSelectOption>
          <AppSelectOption value="right">Right half</AppSelectOption>
        </AppSelect>
      </div>
      {explicitCoverage && (
        <CardCustomizerNumber
          label="Coverage amount"
          value={customizationFieldValue(selected, drafts, "finishCoverageAmount")}
          selectionKey={selectionKey}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          onChange={(next) => onChange("finishCoverageAmount", next)}
        />
      )}
    </div>
  );
}
