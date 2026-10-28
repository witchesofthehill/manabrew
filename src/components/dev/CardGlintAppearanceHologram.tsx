import { useId } from "react";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { CardGlintAppearanceNumber } from "@/components/dev/CardGlintAppearanceNumber";
import {
  APPEARANCE_GROUP,
  APPEARANCE_LEGEND,
  APPEARANCE_SELECT_LABEL,
} from "@/components/dev/cardGlintAppearanceControls.styles";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";

const DEFAULT_RECT = [0.75, 0.8, 0.12, 0.08] as const;
const RECT_FIELDS = [
  { index: 0, label: "Hologram X", min: 0 },
  { index: 1, label: "Hologram Y", min: 0 },
  { index: 2, label: "Hologram width", min: 0.01 },
  { index: 3, label: "Hologram height", min: 0.01 },
] as const;

interface CardGlintAppearanceHologramProps {
  value: CardInspectAppearance;
  onChange: (next: CardInspectAppearance) => void;
}

export function CardGlintAppearanceHologram({ value, onChange }: CardGlintAppearanceHologramProps) {
  const id = useId();
  const hologram = value.hologram;
  const rect = hologram?.rect ?? DEFAULT_RECT;

  return (
    <fieldset className={APPEARANCE_GROUP}>
      <legend className={APPEARANCE_LEGEND}>Local hologram</legend>
      <label htmlFor={id} className={APPEARANCE_SELECT_LABEL}>
        Hologram shape
        <AppSelect
          id={id}
          value={hologram === null ? "off" : (hologram?.shape ?? "native")}
          onValueChange={(shape) => {
            if (shape === "native") {
              const next = { ...value };
              delete next.hologram;
              onChange(next);
            } else if (shape === "off") {
              onChange({ ...value, hologram: null });
            } else if (shape === "ellipse" || shape === "rectangle") {
              onChange({
                ...value,
                hologram: {
                  rect: DEFAULT_RECT,
                  strength: 0.5,
                  seed: 0,
                  ...hologram,
                  shape,
                },
              });
            }
          }}
        >
          <AppSelectOption value="native">Native</AppSelectOption>
          <AppSelectOption value="off">Off</AppSelectOption>
          <AppSelectOption value="ellipse">Ellipse</AppSelectOption>
          <AppSelectOption value="rectangle">Rectangle</AppSelectOption>
        </AppSelect>
      </label>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
        <CardGlintAppearanceNumber
          label="Hologram strength"
          value={hologram?.strength ?? 0.5}
          disabled={!hologram}
          resetKey={value}
          onChange={(strength) => {
            if (hologram) onChange({ ...value, hologram: { ...hologram, strength } });
          }}
        />
        <CardGlintAppearanceNumber
          label="Hologram seed"
          value={hologram?.seed ?? 0}
          max={4_294_967_295}
          integer
          disabled={!hologram}
          resetKey={value}
          onChange={(seed) => {
            if (hologram) onChange({ ...value, hologram: { ...hologram, seed } });
          }}
        />
        {RECT_FIELDS.map(({ index, label, min }) => (
          <CardGlintAppearanceNumber
            key={index}
            label={label}
            value={rect[index]}
            min={min}
            disabled={!hologram}
            resetKey={value}
            onChange={(next) => {
              if (!hologram) return;
              const nextRect: [number, number, number, number] = [...hologram.rect];
              nextRect[index] = next;
              onChange({ ...value, hologram: { ...hologram, rect: nextRect } });
            }}
          />
        ))}
      </div>
      <p className="text-ui-body text-muted-foreground">
        Native keeps the card recipe's hologram; Off removes it. Coordinates start at the top-left.
        Width and height can extend past the card and are clipped at its edge.
      </p>
    </fieldset>
  );
}
