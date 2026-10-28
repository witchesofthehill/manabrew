import { useState } from "react";
import type { CardDto } from "@/protocol/game";
import { useCard } from "@/stores/useScryfallStore";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { ScryfallImg } from "@/components/ScryfallImg";
import {
  BattlefieldCardFace,
  type BattlefieldCardFaceVariant,
} from "@/components/game/BattlefieldCardFace";
import { cn } from "@/lib/utils";
import { Section, Subhead } from "../kit";
type Variant = BattlefieldCardFaceVariant | "realistic";
const VARIANTS: {
  id: Variant;
  label: string;
}[] = [
  {
    id: "realistic",
    label: `Realistic`,
  },
  {
    id: "art",
    label: `Art-forward`,
  },
  {
    id: "frame",
    label: `Mini-frame`,
  },
];
const SPECS: {
  name: string;
  label: string;
  overrides?: Partial<CardDto>;
}[] = [
  {
    name: "Serra Angel",
    label: `White \u00B7 flyer`,
  },
  {
    name: "Snapcaster Mage",
    label: `Blue`,
  },
  {
    name: "Goblin Guide",
    label: `Red \u00B7 attacking`,
    overrides: { isAttacking: true, damage: 1 },
  },
  {
    name: "Llanowar Elves",
    label: `Green \u00B7 tapped`,
    overrides: { tapped: true },
  },
  {
    name: "Dragonlord Atarka",
    label: `R/G \u00B7 +1/+1`,
    overrides: { counters: { P1P1: 2 }, power: "10", toughness: "10" },
  },
  {
    name: "Wurmcoil Engine",
    label: `Colorless artifact`,
  },
  {
    name: "Liliana of the Veil",
    label: `Planeswalker`,
    overrides: { counters: { Loyalty: 6 } },
  },
  {
    name: "Steam Vents",
    label: `Land (U/R)`,
  },
];
function CardTile({
  spec,
  variant,
  width,
}: {
  spec: (typeof SPECS)[number];
  variant: Variant;
  width: number;
}) {
  const entry = useCard({ name: spec.name });
  const size = { width, height: width * (98 / 70) };
  if (!entry) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border text-ui-meta text-muted-foreground"
        style={size}
        data-design-system-pending
      >
        …
      </div>
    );
  }
  const card = scryfallToSampleGameCard(entry.info, spec.overrides);
  return variant === "realistic" ? (
    <ScryfallImg
      src={entry.uris.normal}
      alt={card.identity.name}
      style={size}
      className="rounded object-contain"
    />
  ) : (
    <BattlefieldCardFace
      card={card}
      colorIdentity={entry.info.color_identity}
      artCrop={entry.uris.art_crop}
      variant={variant}
      width={width}
    />
  );
}
function CardSpecimens({ variant }: { variant: Variant }) {
  return (
    <div className="ds-card-grid flex flex-wrap gap-5">
      {SPECS.map((spec) => (
        <div
          key={spec.name + spec.label}
          className="ds-card-specimen flex flex-col items-center gap-1.5"
        >
          <CardTile spec={spec} variant={variant} width={140} />
          <span className="max-w-[140px] text-center text-ui-meta text-muted-foreground">
            {spec.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CardsSection() {
  const [variant, setVariant] = useState<Variant>("art");
  return (
    <Section
      id="cards"
      title={`Card faces`}
      intro="The battlefield card renderer used in-game (DOM path). Three styles — realistic Scryfall image, art-forward, and mini-frame — across representative card types and states."
    >
      <div className="ds-screen-only inline-flex max-w-full flex-wrap rounded-md border border-border">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            aria-pressed={variant === v.id}
            className={cn(
              "min-h-9 min-w-0 px-3 py-1.5 text-ui-label transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11 touch:min-w-11",
              variant === v.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="ds-screen-only">
        <CardSpecimens variant={variant} />
      </div>
      {VARIANTS.map((style) => (
        <div key={style.id} className="ds-print-only ds-card-style space-y-4">
          <Subhead>{style.label}</Subhead>
          <CardSpecimens variant={style.id} />
        </div>
      ))}
    </Section>
  );
}
