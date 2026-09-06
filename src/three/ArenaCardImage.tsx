import { useEffect } from "react";
import type { CardDto } from "@/protocol/game";
import { useCardFaces } from "@/hooks/useCardFaces";

export function ArenaCardImage({
  card,
  onImage,
}: {
  card: CardDto;
  onImage: (id: string, url: string, art?: string) => void;
}) {
  const faces = useCardFaces(card.isFaceDown ? {} : card.identity);
  const image = faces.faces[card.isTransformed ? 1 : 0]?.imageUris?.large;
  const art = faces.faces[card.isTransformed ? 1 : 0]?.imageUris?.art_crop;
  useEffect(() => {
    if (image && !card.isFaceDown) onImage(card.id, image, art);
  }, [image, art, card.id, card.isFaceDown, onImage]);
  return null;
}
