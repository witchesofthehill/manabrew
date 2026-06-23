import { useState } from "react";
import type { CardDto } from "@/protocol/game";
import { useCard } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { ScryfallImg } from "@/components/ScryfallImg";
import {
  BattlefieldCardFace,
  type BattlefieldCardFaceVariant,
} from "@/components/game/BattlefieldCardFace";
import { BoardPlayground } from "@/components/dev/BoardPlayground";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

type GalleryVariant = BattlefieldCardFaceVariant | "realistic";

const VARIANT_LABELS: Record<GalleryVariant, string> = {
  realistic: "Realistic",
  art: "Art-forward",
  frame: "Mini-frame",
};

interface Spec {
  name: string;
  label: string;
  overrides?: Partial<CardDto>;
}

const SPECS: Spec[] = [
  { name: "Serra Angel", label: "White · flyer" },
  { name: "Snapcaster Mage", label: "Blue" },
  { name: "Gravecrawler", label: "Black" },
  { name: "Goblin Guide", label: "Red · haste" },
  { name: "Llanowar Elves", label: "Green · tapped", overrides: { tapped: true } },
  { name: "Tarmogoyf", label: "Green · summoning sick", overrides: { summoningSick: true } },
  {
    name: "Dragonlord Atarka",
    label: "Multicolor (R/G)",
    overrides: { counters: { P1P1: 2 }, power: "10", toughness: "10" },
  },
  { name: "Kitchen Finks", label: "Hybrid (G/W)" },
  { name: "Wurmcoil Engine", label: "Colorless · artifact" },
  { name: "Thought-Knot Seer", label: "Colorless · Eldrazi" },
  {
    name: "Liliana of the Veil",
    label: "Planeswalker · loyalty",
    overrides: { counters: { Loyalty: 6 } },
  },
  {
    name: "Goblin Guide",
    label: "Attacking · damaged",
    overrides: { isAttacking: true, damage: 1 },
  },
  { name: "Steam Vents", label: "Land (U/R)" },
];

function GalleryRow({
  spec,
  variant,
  width,
  showReal,
}: {
  spec: Spec;
  variant: GalleryVariant;
  width: number;
  showReal: boolean;
}) {
  const entry = useCard({ name: spec.name });
  if (!entry) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-muted text-[10px] text-muted-foreground"
        style={{ width, height: width * (98 / 70) }}
      >
        …
      </div>
    );
  }
  const card = scryfallToSampleGameCard(entry.info, spec.overrides);
  const size = { width, height: width * (98 / 70) };
  return (
    <div className="flex items-start gap-2">
      {variant === "realistic" ? (
        <ScryfallImg
          src={entry.uris.normal}
          alt={card.name}
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
      )}
      {showReal && variant !== "realistic" && (
        <ScryfallImg
          src={entry.uris.normal}
          alt={card.name}
          style={size}
          className="rounded object-contain opacity-90"
        />
      )}
    </div>
  );
}

export default function CardMockGallery() {
  // Bound to the real preference so the one toggle drives both the DOM previews
  // and the live Pixi board playground below (which reads the same pref).
  const variant = usePreferencesStore((s) => s.battlefieldCardStyle) as GalleryVariant;
  const setVariant = usePreferencesStore((s) => s.setBattlefieldCardStyle);
  const [showReal, setShowReal] = useState(false);

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <header className="flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold">Battlefield card face — dev gallery</h1>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {(["realistic", "art", "frame"] as GalleryVariant[]).map((v) => (
            <button
              key={v}
              onClick={() => setVariant(v)}
              className={cn(
                "px-3 py-1.5 text-sm",
                variant === v ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
              )}
            >
              {VARIANT_LABELS[v]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showReal}
            onChange={(e) => setShowReal(e.target.checked)}
          />
          show real Scryfall card beside
        </label>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Pixi board playground — spawn cards + poke them to test in-game effects
        </h2>
        <BoardPlayground />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Battlefield size (70×98)</h2>
        <div className="flex flex-wrap gap-4">
          {SPECS.map((spec, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-1"
              style={{ width: Math.max(98, showReal ? 70 * 2 + 8 : 0) }}
            >
              <GalleryRow spec={spec} variant={variant} width={70} showReal={showReal} />
              <span className="text-[10px] text-muted-foreground max-w-[70px] text-center leading-tight">
                {spec.label}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          3× preview (210×294) — same component, crisp text
        </h2>
        <div className="flex flex-wrap gap-6">
          {SPECS.map((spec, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-1"
              style={{ width: Math.max(294, showReal ? 210 * 2 + 8 : 0) }}
            >
              <GalleryRow spec={spec} variant={variant} width={210} showReal={showReal} />
              <span className="text-xs text-muted-foreground">{spec.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
