import { useEffect, useMemo } from "react";
import { cmcBucketIndex, scryfallToDeckCard } from "@/components/editor/deckBuilder.utils";
import type { BuildFilters } from "@/components/limited/LimitedBuildFilters";
import type { BuildGroup } from "@/components/limited/useLimitedBuildStore";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

export function useLimitedBuildCards(
  cards: DraftCard[],
  filters: BuildFilters,
  group: BuildGroup | undefined,
) {
  const cache = useScryfallStore((state) => state.cards);
  const locale = useScryfallStore((state) => state.locale);
  useEffect(() => {
    const store = useScryfallStore.getState();
    for (const card of cards)
      void store
        .getCard({ name: card.name, setCode: card.setCode, cardNumber: card.cardNumber })
        .catch(() => undefined);
  }, [cards, locale]);
  const filtered = useMemo(() => {
    const search = filters.search.trim().toLocaleLowerCase();
    return cards
      .filter((card) => {
        const info = peekCard(cache, card);
        if (!info)
          return (
            (!search || card.name.toLocaleLowerCase().includes(search)) &&
            !filters.colors.length &&
            filters.type === "all" &&
            filters.manaValue == null
          );
        const faces = info.card_faces ?? [];
        const type = info.type_line ?? faces[0]?.type_line ?? "";
        const colors = info.colors ?? faces[0]?.colors ?? [];
        if (
          filters.manaValue != null &&
          cmcBucketIndex(scryfallToDeckCard(info)) !== filters.manaValue
        )
          return false;
        if (filters.type !== "all" && !type.includes(filters.type)) return false;
        if (
          filters.colors.length &&
          !filters.colors.some((color) =>
            color === "C"
              ? !colors.length
              : color === "M"
                ? colors.length > 1
                : colors.includes(color),
          )
        )
          return false;
        return (
          !search ||
          [
            card.name,
            info.printed_name,
            type,
            info.oracle_text,
            ...faces.flatMap((face) => [face.name, face.printed_name, face.oracle_text]),
          ].some((text) => text?.toLocaleLowerCase().includes(search))
        );
      })
      .sort((a, b) => {
        const first = peekCard(cache, a);
        const second = peekCard(cache, b);
        const value = (card: typeof first) => {
          if (!card) return "zz-pending";
          const type = card.card_faces?.[0]?.type_line ?? card.type_line;
          if ((group === "cmc" || group === "color") && type.includes("Land")) return "zz-lands";
          if (group === "cmc") return String(card.cmc ?? 0).padStart(3, "0");
          if (group === "color")
            return (card.colors ?? card.card_faces?.[0]?.colors ?? []).join("");
          if (group === "type") return type.split("—")[0].trim();
          return group === "rarity" ? card.rarity : "";
        };
        return (
          value(first).localeCompare(value(second)) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
        );
      });
  }, [cards, cache, filters, group]);
  return filtered;
}
