import { useCallback } from "react";
import { toast } from "sonner";
import { fetchCardCollection, fetchCardByFuzzyName } from "@/api/scryfall";
import { showAccountSaveNudge } from "@/components/auth/accountSaveNudge";
import { DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { inferImportedFormat, type ParsedDeckEntry } from "@/lib/deckImport";
import { getFormat } from "@/lib/formats";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import type { DeckCard, DeckFormat } from "@/protocol/deck";

export function useDeckTextImport() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      name: string,
      formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
    ): Promise<string> => {
      const customName = name.trim();
      onProgress(0.05);
      const scryfallMap = await fetchCardCollection(entries.map((e) => ({ name: e.name })));
      onProgress(0.55);
      // Cards with name variants miss the exact lookup; retry them with fuzzy search.
      const stragglers = [
        ...new Set(entries.map((e) => e.name).filter((n) => !scryfallMap.get(n.toLowerCase()))),
      ];
      let resolved = 0;
      await Promise.all(
        stragglers.map((n) =>
          fetchCardByFuzzyName(n)
            .then((sc) => scryfallMap.set(n.toLowerCase(), sc))
            .catch((err) => console.warn(`[import] fuzzy "${n}" failed`, err))
            .finally(() => {
              resolved += 1;
              onProgress(0.55 + 0.35 * (resolved / stragglers.length));
            }),
        ),
      );
      onProgress(0.9);
      const cards: DeckCard[] = [];
      const sideboard: DeckCard[] = [];
      const maybeboard: DeckCard[] = [];
      const commanders: DeckCard[] = [];
      const notFound: string[] = [];
      for (const { name: cardName, count, side, maybe, commander } of entries) {
        const sc = scryfallMap.get(cardName.toLowerCase());
        if (!sc) {
          notFound.push(cardName);
          continue;
        }
        const target = commander ? commanders : side ? sideboard : maybe ? maybeboard : cards;
        for (let i = 0; i < count; i++) {
          const base = scryfallToDeckCard(sc);
          target.push({ ...base, identity: { ...base.identity, id: crypto.randomUUID() } });
        }
      }
      if (
        cards.length === 0 &&
        sideboard.length === 0 &&
        maybeboard.length === 0 &&
        commanders.length === 0
      ) {
        throw new Error("None of the cards could be found on Scryfall");
      }
      const commanderName = commanders.map((c) => c.identity.name).join(" / ");
      const deckName = customName || commanderName || DEFAULT_IMPORT_NAME;
      const importedFormat =
        formatId ??
        (commanders.length > 0
          ? "commander"
          : inferImportedFormat(cards.map((c) => c.identity.name)));
      const format = getFormat(importedFormat);
      const keepsCommanders = format?.deckRules.requiresCommander ?? false;
      const importedCards = keepsCommanders ? cards : [...cards, ...commanders];
      const importedCommanders = keepsCommanders ? commanders : [];
      const id = useDeckStore.getState().addSavedDeck({
        name: deckName,
        format: importedFormat,
        cards: importedCards,
        sideboard,
        maybeboard,
        commanders: importedCommanders,
        draft:
          importedCards.length + importedCommanders.length < (format?.deckRules.minDeckSize ?? 0),
        attractions: [],
        contraptions: [],
        schemes: [],
        planes: [],
      });
      onProgress(1);
      if (notFound.length > 0) {
        const shown = notFound.slice(0, 3).join(", ");
        const extra = notFound.length > 3 ? ` +${notFound.length - 3} more` : "";
        toast.warning(`Imported "${deckName}" — couldn't find: ${shown}${extra}`);
      } else {
        toast.success(`Imported "${deckName}"`);
      }
      showAccountSaveNudge();
      return id;
    },
    [],
  );
}
