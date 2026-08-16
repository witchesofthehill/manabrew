import { useCallback } from "react";
import { toast } from "sonner";
import { scryfallCardKey } from "@/api/scryfall";
import { DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { inferImportedFormat, type ParsedDeckEntry } from "@/lib/deckImport";
import { getFormat } from "@/lib/formats";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { showAccountSaveNudge } from "@/components/auth/accountSaveNudge";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import { executeDeckEdit } from "./deckEditor.history";

export interface ResolvedDeckTextImport {
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
  commanders: DeckCard[];
  notFound: string[];
}

export async function resolveDeckTextImport(
  entries: ParsedDeckEntry[],
  onProgress: (fraction: number) => void,
): Promise<ResolvedDeckTextImport> {
  onProgress(0.05);
  const scryfallMap = await useScryfallStore.getState().fetchCardCollection(
    entries.map((e) => ({
      name: e.name,
      setCode: e.setCode,
      collectorNumber: e.collectorNumber,
    })),
  );
  const lookup = (entry: ParsedDeckEntry) => {
    if (entry.setCode && entry.collectorNumber) {
      return scryfallMap.get(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber));
    }
    return (
      scryfallMap.get(scryfallCardKey(entry.name, entry.setCode)) ??
      scryfallMap.get(scryfallCardKey(entry.name))
    );
  };
  onProgress(0.5);
  onProgress(0.55);
  const stragglers = [
    ...new Set(
      entries
        .filter((entry) => !entry.setCode && !entry.collectorNumber && !lookup(entry))
        .map((entry) => entry.name),
    ),
  ];
  let resolved = 0;
  await Promise.all(
    stragglers.map((n) =>
      useScryfallStore
        .getState()
        .fetchCardByFuzzyName(n)
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
  for (const entry of entries) {
    const { count, side, maybe, commander } = entry;
    const sc = lookup(entry);
    if (!sc) {
      notFound.push(entry.name);
      continue;
    }
    const target = commander ? commanders : side ? sideboard : maybe ? maybeboard : cards;
    for (let i = 0; i < count; i++) {
      const base = scryfallToDeckCard(sc);
      target.push({
        ...base,
        identity: { ...base.identity, id: crypto.randomUUID(), foil: entry.foil },
      });
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
  return { cards, sideboard, maybeboard, commanders, notFound };
}

export function useDeckTextImport() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      name: string,
      formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
    ): Promise<string> => {
      const customName = name.trim();
      const { cards, sideboard, maybeboard, commanders, notFound } = await resolveDeckTextImport(
        entries,
        onProgress,
      );
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
      showAccountSaveNudge();
      onProgress(1);
      if (notFound.length > 0) {
        const shown = notFound.slice(0, 3).join(", ");
        const extra = notFound.length > 3 ? ` +${notFound.length - 3} more` : "";
        toast.warning(`Imported "${deckName}" — couldn't find: ${shown}${extra}`);
      } else {
        toast.success(`Imported "${deckName}"`);
      }
      return id;
    },
    [],
  );
}

export function useDeckTextImportIntoCurrent() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      _name: string,
      _formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
    ): Promise<boolean> => {
      const startingSessionId = useDeckStore.getState().editorSessionId;
      const result = await resolveDeckTextImport(entries, onProgress);
      if (useDeckStore.getState().editorSessionId !== startingSessionId) {
        return false;
      }
      executeDeckEdit("Import card list", () =>
        useDeckStore.getState().mergeIntoCurrentDeck(result),
      );
      onProgress(1);
      const count =
        result.cards.length +
        result.sideboard.length +
        result.maybeboard.length +
        result.commanders.length;
      if (result.notFound.length > 0) {
        const shown = result.notFound.slice(0, 3).join(", ");
        const extra = result.notFound.length > 3 ? ` +${result.notFound.length - 3} more` : "";
        toast.warning(`Added ${count} cards — couldn't find: ${shown}${extra}`);
      } else {
        toast.success(`Added ${count} cards to this deck`);
      }
      return true;
    },
    [],
  );
}
