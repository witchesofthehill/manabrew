import { CardGlintAppearanceNumber } from "@/components/dev/CardGlintAppearanceNumber";
import { CardGlintAppearancePrinting } from "@/components/dev/CardGlintAppearancePrinting";
import { CardGlintAppearanceHologram } from "@/components/dev/CardGlintAppearanceHologram";
import {
  APPEARANCE_GROUP,
  APPEARANCE_LEGEND,
} from "@/components/dev/cardGlintAppearanceControls.styles";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";
import type { CardFinish } from "@/protocol/deck";

interface CardGlintAppearanceControlsProps {
  value: CardInspectAppearance;
  onChange: (next: CardInspectAppearance) => void;
  finish: CardFinish;
}

export function CardGlintAppearanceControls({
  value,
  onChange,
  finish,
}: CardGlintAppearanceControlsProps) {
  const wear = { amount: 0, seed: 0, ...value.wear };
  const dots = { amount: 0, period: 5, variation: 0.5, inset: 0, ...value.printDots };

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
      <fieldset className={APPEARANCE_GROUP}>
        <legend className={APPEARANCE_LEGEND}>Finish material</legend>
        <CardGlintAppearanceNumber
          label="Rain fog"
          value={value.rainFog ?? 1}
          max={2}
          disabled={finish !== "rain"}
          resetKey={value}
          onChange={(rainFog) => onChange({ ...value, rainFog })}
        />
        <CardGlintAppearanceNumber
          label="Coating amount"
          value={value.cardstock?.amount ?? 0}
          disabled={finish === "regular"}
          resetKey={value}
          onChange={(amount) => onChange({ ...value, cardstock: { amount } })}
        />
        <CardGlintAppearanceNumber
          label="Heat deformation"
          value={value.deformation?.amount ?? 0}
          max={0.02}
          step={0.0001}
          disabled={finish !== "heat"}
          resetKey={value}
          onChange={(amount) => onChange({ ...value, deformation: { kind: "heat", amount } })}
        />
        <p className="text-xs text-muted-foreground">
          Fog needs Rain; coating needs a non-Regular finish; deformation needs Heat. Inactive
          values are kept when you switch finishes.
        </p>
      </fieldset>
      <fieldset className={APPEARANCE_GROUP}>
        <legend className={APPEARANCE_LEGEND}>Surface wear</legend>
        <CardGlintAppearanceNumber
          label="Wear amount"
          value={wear.amount}
          resetKey={value}
          onChange={(amount) => onChange({ ...value, wear: { ...wear, amount } })}
        />
        <CardGlintAppearanceNumber
          label="Wear seed"
          value={wear.seed}
          max={4_294_967_295}
          integer
          resetKey={value}
          onChange={(seed) => onChange({ ...value, wear: { ...wear, seed } })}
        />
      </fieldset>
      <fieldset className={APPEARANCE_GROUP}>
        <legend className={APPEARANCE_LEGEND}>Print dots</legend>
        <p className="text-xs text-muted-foreground">
          Available on every finish. Original scans may already contain print dots.
        </p>
        <CardGlintAppearanceNumber
          label="Print dots amount"
          value={dots.amount}
          resetKey={value}
          onChange={(amount) => onChange({ ...value, printDots: { ...dots, amount } })}
        />
        <CardGlintAppearanceNumber
          label="Print dots period"
          value={dots.period}
          min={2}
          max={16}
          step={0.1}
          resetKey={value}
          onChange={(period) => onChange({ ...value, printDots: { ...dots, period } })}
        />
        <CardGlintAppearanceNumber
          label="Print dots variation"
          value={dots.variation}
          resetKey={value}
          onChange={(variation) => onChange({ ...value, printDots: { ...dots, variation } })}
        />
        <CardGlintAppearanceNumber
          label="Print dots inset"
          value={dots.inset}
          max={0.2}
          step={0.001}
          resetKey={value}
          onChange={(inset) => onChange({ ...value, printDots: { ...dots, inset } })}
        />
      </fieldset>
      <CardGlintAppearancePrinting value={value} onChange={onChange} />
      <CardGlintAppearanceHologram value={value} onChange={onChange} />
    </div>
  );
}
