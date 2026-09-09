import { useEffect, useMemo, useState } from "react";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { isFacelessCard } from "@/lib/gameCard";
import type { CardBrowserItem } from "./cardBrowser";

export function useBrowserSearchItems(items: CardBrowserItem[]) {
  const bucket = useScryfallStore((s) => s.cards);
  const [loading, setLoading] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  useEffect(() => {
    let active = true;
    const unique = [
      ...new Map(
        items
          .filter((item) => !isFacelessCard(item.card))
          .map((item) => [item.card.identity.name, item.card]),
      ).values(),
    ];
    const missing = unique.filter(
      (card) =>
        !peekCard(useScryfallStore.getState().cards, {
          name: card.identity.name,
          setCode: card.identity.setCode || undefined,
          cardNumber: card.identity.cardNumber || undefined,
        }),
    );
    void (async () => {
      setLoading(missing.length > 0);
      setIncomplete(false);
      for (const card of missing) {
        if (!active) break;
        try {
          await useScryfallStore.getState().getCard({
            name: card.identity.name,
            setCode: card.identity.setCode || undefined,
            cardNumber: card.identity.cardNumber || undefined,
          });
        } catch {
          if (active) setIncomplete(true);
        }
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [items]);
  const searchable = useMemo(
    () =>
      items.map((item) => {
        if (isFacelessCard(item.card)) return item;
        const info = peekCard(bucket, {
          name: item.card.identity.name,
          setCode: item.card.identity.setCode || undefined,
          cardNumber: item.card.identity.cardNumber || undefined,
        });
        return {
          ...item,
          searchText: [
            info?.oracle_text,
            info?.type_line,
            ...(info?.card_faces ?? []).flatMap((face) => [
              face.name,
              face.oracle_text,
              face.type_line,
            ]),
          ]
            .filter(Boolean)
            .join(" "),
        };
      }),
    [items, bucket],
  );
  return { searchable, loading, incomplete };
}
