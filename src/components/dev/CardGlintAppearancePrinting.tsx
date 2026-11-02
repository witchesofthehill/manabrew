import { useId } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CardGlintAppearanceNumber } from "@/components/dev/CardGlintAppearanceNumber";
import {
  APPEARANCE_GROUP,
  APPEARANCE_LEGEND,
  APPEARANCE_SELECT_LABEL,
} from "@/components/dev/cardGlintAppearanceControls.styles";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";

interface CardGlintAppearancePrintingProps {
  value: CardInspectAppearance;
  onChange: (next: CardInspectAppearance) => void;
}

export function CardGlintAppearancePrinting({ value, onChange }: CardGlintAppearancePrintingProps) {
  const coverageId = useId();
  const printingId = useId();
  const coverage = value.coverage;
  const overlay = value.overlayFoil;

  return (
    <>
      <fieldset className={APPEARANCE_GROUP}>
        <legend className={APPEARANCE_LEGEND}>Finish coverage</legend>
        <label htmlFor={coverageId} className={APPEARANCE_SELECT_LABEL}>
          Coverage area
          <AppSelect
            id={coverageId}
            value={coverage?.area ?? "native"}
            onValueChange={(area) => {
              if (area === "native") {
                const next = { ...value };
                delete next.coverage;
                onChange(next);
              } else if (
                area === "full" ||
                area === "artwork" ||
                area === "left" ||
                area === "right"
              ) {
                onChange({ ...value, coverage: { area, amount: coverage?.amount ?? 1 } });
              }
            }}
          >
            <AppSelectOption value="native">Native</AppSelectOption>
            <AppSelectOption value="full">Full card</AppSelectOption>
            <AppSelectOption value="artwork">Artwork only</AppSelectOption>
            <AppSelectOption value="left">Left half</AppSelectOption>
            <AppSelectOption value="right">Right half</AppSelectOption>
          </AppSelect>
        </label>
        <CardGlintAppearanceNumber
          label="Coverage amount"
          value={coverage?.amount ?? 1}
          disabled={!coverage}
          resetKey={value}
          onChange={(amount) => {
            if (coverage) onChange({ ...value, coverage: { ...coverage, amount } });
          }}
        />
        <p className="text-ui-body text-muted-foreground">
          Native keeps the card recipe's coverage.
        </p>
      </fieldset>
      <fieldset className={APPEARANCE_GROUP}>
        <legend className={APPEARANCE_LEGEND}>Protected printing</legend>
        <label htmlFor={printingId} className={APPEARANCE_SELECT_LABEL}>
          Printing reflection
          <AppSelect
            id={printingId}
            value={overlay === null ? "off" : (overlay?.tone ?? "native")}
            onValueChange={(tone) => {
              if (tone === "native") {
                const next = { ...value };
                delete next.overlayFoil;
                onChange(next);
              } else if (tone === "off") {
                onChange({ ...value, overlayFoil: null });
              } else if (tone === "gold" || tone === "silver" || tone === "prismatic") {
                onChange({ ...value, overlayFoil: { tone, strength: overlay?.strength ?? 0.5 } });
              }
            }}
          >
            <AppSelectOption value="native">Native</AppSelectOption>
            <AppSelectOption value="off">Off</AppSelectOption>
            <AppSelectOption value="gold">Gold</AppSelectOption>
            <AppSelectOption value="silver">Silver</AppSelectOption>
            <AppSelectOption value="prismatic">Prismatic</AppSelectOption>
          </AppSelect>
        </label>
        <CardGlintAppearanceNumber
          label="Protected printing strength"
          value={overlay?.strength ?? 0.5}
          disabled={!overlay}
          resetKey={value}
          onChange={(strength) => {
            if (overlay) onChange({ ...value, overlayFoil: { ...overlay, strength } });
          }}
        />
        <p className="text-ui-body text-muted-foreground">
          Native keeps the card recipe's printing reflection. Off removes it.
        </p>
      </fieldset>
    </>
  );
}
