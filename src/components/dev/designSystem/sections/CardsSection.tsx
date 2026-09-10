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
import { Section } from "../kit";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
type Variant = BattlefieldCardFaceVariant | "realistic";
const VARIANTS: {
  id: Variant;
  label: string;
}[] = [
  {
    id: "realistic",
    get label() {
      return i18n._(msg`Realistic`);
    },
  },
  {
    id: "art",
    get label() {
      return i18n._(msg`Art-forward`);
    },
  },
  {
    id: "frame",
    get label() {
      return i18n._(msg`Mini-frame`);
    },
  },
];
const SPECS: {
  name: string;
  label: string;
  overrides?: Partial<CardDto>;
}[] = [
  {
    name: "Serra Angel",
    get label() {
      return i18n._(msg`White \u00B7 flyer`);
    },
  },
  {
    name: "Snapcaster Mage",
    get label() {
      return i18n._(msg`Blue`);
    },
  },
  {
    name: "Goblin Guide",
    get label() {
      return i18n._(msg`Red \u00B7 attacking`);
    },
    overrides: { isAttacking: true, damage: 1 },
  },
  {
    name: "Llanowar Elves",
    get label() {
      return i18n._(msg`Green \u00B7 tapped`);
    },
    overrides: { tapped: true },
  },
  {
    name: "Dragonlord Atarka",
    get label() {
      return i18n._(msg`R/G \u00B7 +1/+1`);
    },
    overrides: { counters: { P1P1: 2 }, power: "10", toughness: "10" },
  },
  {
    name: "Wurmcoil Engine",
    get label() {
      return i18n._(msg`Colorless artifact`);
    },
  },
  {
    name: "Liliana of the Veil",
    get label() {
      return i18n._(msg`Planeswalker`);
    },
    overrides: { counters: { Loyalty: 6 } },
  },
  {
    name: "Steam Vents",
    get label() {
      return i18n._(msg`Land (U/R)`);
    },
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
        className="flex items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground"
        style={size}
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
export function CardsSection() {
  const [variant, setVariant] = useState<Variant>("art");
  return (
    <Section
      id="cards"
      title={i18n._(msg`Card faces`)}
      intro="The battlefield card renderer used in-game (DOM path). Three styles — realistic Scryfall image, art-forward, and mini-frame — across representative card types and states."
    >
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            className={cn(
              "px-3 py-1.5 text-sm transition-colors",
              variant === v.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-5">
        {SPECS.map((spec) => (
          <div key={spec.name + spec.label} className="flex flex-col items-center gap-1.5">
            <CardTile spec={spec} variant={variant} width={140} />
            <span className="max-w-[140px] text-center text-[11px] leading-tight text-muted-foreground">
              {spec.label}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
