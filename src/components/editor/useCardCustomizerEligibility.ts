import { useEffect, useState } from "react";
import { isTwoFaceLayout } from "@/lib/cardLayout";
import { supportsRetroCardFrame } from "@/lib/cardRenderDecision";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";

function supportsRetroCopy(card: DeckCard, printing?: ScryfallCard): boolean {
  const layout = printing?.layout ?? card.layout;
  const faces = printing?.card_faces ?? [];
  const needsBack = card.isDoubleFaced || isTwoFaceLayout(layout);
  if (!supportsRetroCardFrame({ ...card, layout })) return false;
  if (needsBack && !card.backFace && faces.length < 2) return false;
  const faceData = [
    ...faces.map((face) => ({ typeLine: face.type_line, text: face.oracle_text })),
    ...(card.backFace
      ? [{ typeLine: card.backFace.typeLine, text: card.backFace.oracleText }]
      : []),
  ];
  return faceData.every((face) =>
    supportsRetroCardFrame({
      layout,
      types: (face.typeLine ?? "").split(/[^A-Za-z]+/),
      subtypes: [],
      text: face.text ?? "",
    }),
  );
}

export function useCardCustomizerEligibility(copies: readonly DeckCard[]) {
  const locale = useScryfallStore((state) => state.locale);
  const [resolved, setResolved] = useState<{
    copies: readonly DeckCard[];
    locale: string;
    supported: ReadonlySet<string>;
  }>();
  useEffect(() => {
    let alive = true;
    void Promise.all(
      copies.map(async (card) => {
        let printing: ScryfallCard | undefined;
        try {
          printing = (
            await useScryfallStore.getState().getCard({
              name: card.identity.name,
              setCode: card.identity.setCode || undefined,
              cardNumber: card.identity.cardNumber || undefined,
            })
          ).info;
        } catch {
          printing = undefined;
        }
        return supportsRetroCopy(card, printing) ? card.identity.id : undefined;
      }),
    ).then((ids) => {
      if (alive)
        setResolved({ copies, locale, supported: new Set(ids.filter((id) => id !== undefined)) });
    });
    return () => {
      alive = false;
    };
  }, [copies, locale]);
  return resolved?.copies === copies && resolved.locale === locale ? resolved.supported : undefined;
}
