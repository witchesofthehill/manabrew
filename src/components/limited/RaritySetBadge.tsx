import { useCard, useSetLookup } from "@/stores/useScryfallStore";
import { effectiveRarity, RARITY_LABEL, rarityToken } from "@/lib/limited.utils";
import { RaritySetSymbol } from "@/components/limited/RaritySetSymbol";
import type { DraftCard } from "@/types/limited";

interface RaritySetBadgeProps {
  card: DraftCard;
}

export function RaritySetBadge({ card }: RaritySetBadgeProps) {
  // Rarity is a Scryfall fact, not something the engine echoes back —
  // resolve it via the canonical store. Renders nothing while the
  // lookup is pending so the badge can't briefly flash as Unknown.
  const scry = useCard({
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
  });
  const setLookup = useSetLookup();
  const rarity = effectiveRarity(scry?.info);
  if (!rarityToken(rarity)) return null;

  const set = card.setCode ? setLookup.get(card.setCode.toLowerCase()) : undefined;
  const label = RARITY_LABEL[rarity];

  return (
    <span
      className="pointer-events-none absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 ring-1 ring-white/10"
      title={set ? `${label} · ${set.name}` : label}
    >
      <RaritySetSymbol rarity={rarity} setCode={card.setCode} className="h-3 w-3" />
    </span>
  );
}
