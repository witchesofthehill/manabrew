import { useCard } from "@/stores/useScryfallStore";
import { ScryfallImg } from "@/components/ScryfallImg";
import { scryfallToSampleGameCard } from "@/lib/sampleGameCard";
import { cardFaceImageUris } from "@/lib/cardImage";
import { BattlefieldCardFace } from "./BattlefieldCardFace";
import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";

const SAMPLE_CARD = "Goblin Guide";

interface BattlefieldStylePreviewProps {
  style: BattlefieldCardStyle;
  width?: number;
}

export function BattlefieldStylePreview({ style, width = 88 }: BattlefieldStylePreviewProps) {
  const entry = useCard({ name: SAMPLE_CARD });
  const height = width * (98 / 70);
  const uris = entry ? cardFaceImageUris(entry.info, entry.uris) : undefined;

  if (!uris) {
    return (
      <div
        className="shrink-0 rounded-md border border-dashed border-border"
        style={{ width, height }}
      />
    );
  }

  if (style === "realistic") {
    return (
      <ScryfallImg
        src={uris.normal}
        alt={SAMPLE_CARD}
        className="shrink-0 rounded-md object-contain"
        style={{ width, height }}
      />
    );
  }

  return (
    <div className="shrink-0">
      <BattlefieldCardFace
        card={scryfallToSampleGameCard(entry!.info)}
        artCrop={uris.art_crop}
        variant={style}
        width={width}
      />
    </div>
  );
}
