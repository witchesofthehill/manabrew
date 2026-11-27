import { useCallback } from "react";
import { toast } from "sonner";
import { scryfallCardKey } from "@/api/scryfall";
import { DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsDuration } from "@/lib/clientAnalyticsPrivacy";
import {
  deckImportEntryZone,
  inferImportedFormat,
  parseDeckListTextReview,
  type ParsedDeckEntry,
} from "@/lib/deckImport";
import { resolveDeckName } from "@/lib/deckName";
import { getFormat, isCommanderEligible } from "@/lib/formats";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { normalizeDeck, useDeckStore } from "@/stores/useDeckStore";
import { showAccountSaveNudge } from "@/components/auth/accountSaveNudge";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import { executeDeckEdit } from "./deckEditor.history";
export interface ResolvedDeckTextImport {
  cards: DeckCard[];
  sideboard: DeckCard[];
  maybeboard: DeckCard[];
  commanders: DeckCard[];
  notFound: string[];
  substitutedPrintings: string[];
}
export async function resolveDeckTextImport(
  entries: ParsedDeckEntry[],
  onProgress: (fraction: number) => void,
  strict = false,
): Promise<ResolvedDeckTextImport> {
  onProgress(0.05);
  const scryfallMap = await useScryfallStore.getState().fetchCardCollection(
    entries.map((e) => ({
      name: e.name,
      setCode: e.setCode,
      collectorNumber: e.collectorNumber,
    })),
  );
  const exactPrintingMisses = entries.filter(
    (entry) =>
      entry.setCode &&
      entry.collectorNumber &&
      !scryfallMap.has(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber)),
  );
  if (!strict && exactPrintingMisses.length > 0) {
    const fallbacks = await useScryfallStore
      .getState()
      .fetchCardCollection(exactPrintingMisses.map((entry) => ({ name: entry.name })));
    for (const [key, card] of fallbacks) scryfallMap.set(key, card);
  }
  const lookup = (entry: ParsedDeckEntry) => {
    if (strict) {
      return scryfallMap.get(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber));
    }
    if (entry.setCode && entry.collectorNumber) {
      return (
        scryfallMap.get(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber)) ??
        scryfallMap.get(scryfallCardKey(entry.name))
      );
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
        .filter((entry) => !strict && !entry.setCode && !entry.collectorNumber && !lookup(entry))
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
  const substitutedPrintings: string[] = [];
  for (const entry of entries) {
    const { count, side, maybe, commander } = entry;
    const sc = lookup(entry);
    if (!sc) {
      notFound.push(entry.name);
      continue;
    }
    const exactPrintingFound =
      !entry.setCode ||
      !entry.collectorNumber ||
      (scryfallMap.has(scryfallCardKey(entry.name, entry.setCode, entry.collectorNumber)) &&
        (!strict ||
          (sc.set.toLowerCase() === entry.setCode.toLowerCase() &&
            sc.collector_number.toLowerCase() === entry.collectorNumber.toLowerCase())));
    if (
      !exactPrintingFound ||
      (strict && entry.setCode && sc.set.toLowerCase() !== entry.setCode)
    ) {
      substitutedPrintings.push(entry.name);
      if (strict) continue;
    }
    const base = scryfallToDeckCard(sc);
    const inferredCommander = entry.commanderCandidate && isCommanderEligible(base);
    const target =
      commander || inferredCommander ? commanders : side ? sideboard : maybe ? maybeboard : cards;
    for (let i = 0; i < count; i++) {
      target.push({
        ...base,
        identity: { ...base.identity, id: crypto.randomUUID(), foil: entry.foil },
      });
    }
  }
  if (strict && (notFound.length > 0 || substitutedPrintings.length > 0)) {
    const failed = [...new Set([...notFound, ...substitutedPrintings])];
    throw new Error(
      `No changes applied. Could not verify these cards or requested printings: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` +${failed.length - 3} more` : ""}. Check the list and try again.`,
    );
  }
  if (
    cards.length === 0 &&
    sideboard.length === 0 &&
    maybeboard.length === 0 &&
    commanders.length === 0
  ) {
    throw new Error("None of the cards could be found on Scryfall");
  }
  return { cards, sideboard, maybeboard, commanders, notFound, substitutedPrintings };
}
export function useDeckTextImport() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      name: string,
      formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
      source: "text" | "clipboard" = "text",
    ): Promise<string> => {
      const startedAt = performance.now();
      try {
        const customName = name.trim();
        const { cards, sideboard, maybeboard, commanders, notFound, substitutedPrintings } =
          await resolveDeckTextImport(entries, onProgress);
        const deckName = resolveDeckName(customName || DEFAULT_IMPORT_NAME, commanders);
        const importedFormat =
          formatId ??
          (commanders.length > 0
            ? "commander"
            : inferImportedFormat(cards.map((c) => c.identity.name)));
        const format = getFormat(importedFormat);
        const keepsCommanders = format?.deckRules.requiresCommander ?? false;
        const importedCards = keepsCommanders ? cards : [...cards, ...commanders];
        const importedCommanders = keepsCommanders ? commanders : [];
        const deck = normalizeDeck({
          name: deckName,
          format: importedFormat,
          cards: importedCards,
          sideboard,
          maybeboard,
          commanders: importedCommanders,
          attractions: [],
          contraptions: [],
          schemes: [],
          planes: [],
        });
        const id = useDeckStore.getState().addSavedDeck({
          ...deck,
          draft:
            deck.cards.length + (deck.commanders?.length ?? 0) <
            (format?.deckRules.minDeckSize ?? 0),
        });
        showAccountSaveNudge();
        onProgress(1);
        if (notFound.length > 0) {
          const shown = notFound.slice(0, 3).join(", ");
          const extra = notFound.length > 3 ? ` +${notFound.length - 3} more` : "";
          toast.warning(`Imported "${deckName}" — couldn't find: ${shown}${extra}`);
        } else if (substitutedPrintings.length > 0) {
          toast.warning(
            substitutedPrintings.length === 1
              ? `Imported "${deckName}" with one default printing substitution`
              : `Imported "${deckName}" with ${substitutedPrintings.length} default printing substitutions`,
          );
        } else {
          toast.success(`Imported "${deckName}"`);
        }
        trackClientEvent("deck_import", {
          source,
          mode: "create",
          outcome: notFound.length > 0 ? "partial" : "success",
          duration: analyticsDuration(performance.now() - startedAt),
        });
        return id;
      } catch (error) {
        trackClientEvent("deck_import", {
          source,
          mode: "create",
          outcome: "failure",
          duration: analyticsDuration(performance.now() - startedAt),
        });
        throw error;
      }
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
      source: "text" | "clipboard" = "text",
    ): Promise<boolean> => {
      const startedAt = performance.now();
      try {
        const startingSessionId = useDeckStore.getState().editorSessionId;
        const result = await resolveDeckTextImport(entries, onProgress);
        if (useDeckStore.getState().editorSessionId !== startingSessionId) {
          return false;
        }
        executeDeckEdit(`Import card list`, () =>
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
        } else if (result.substitutedPrintings.length > 0) {
          toast.warning(
            result.substitutedPrintings.length === 1
              ? `Added ${count} cards with one default printing substitution`
              : `Added ${count} cards with ${result.substitutedPrintings.length} default printing substitutions`,
          );
        } else {
          toast.success(`Added ${count} cards to this deck`);
        }
        trackClientEvent("deck_import", {
          source,
          mode: "add",
          outcome: result.notFound.length > 0 ? "partial" : "success",
          duration: analyticsDuration(performance.now() - startedAt),
        });
        return true;
      } catch (error) {
        trackClientEvent("deck_import", {
          source,
          mode: "add",
          outcome: "failure",
          duration: analyticsDuration(performance.now() - startedAt),
        });
        throw error;
      }
    },
    [],
  );
}
function deckCardPrintingKey(name: string, setCode: string, cardNumber: string, foil?: boolean) {
  return `${name.toLowerCase()}::${setCode.toLowerCase()}::${cardNumber.toLowerCase()}::${foil === true}`;
}
function reuseCurrentDeckCards(deck: EditorDeck, entries: ParsedDeckEntry[]) {
  const pool = new Map<string, { card: DeckCard; zone: string }[]>();
  for (const [zone, cards] of [
    ["commander", deck.commanders ?? []],
    ["main", deck.cards],
    ["side", deck.sideboard],
    ["maybe", deck.maybeboard ?? []],
  ] as const) {
    for (const card of cards) {
      const { name, setCode, cardNumber, foil } = card.identity;
      const key = deckCardPrintingKey(name, setCode, cardNumber, foil);
      const matches = pool.get(key);
      if (matches) matches.push({ card, zone });
      else pool.set(key, [{ card, zone }]);
    }
  }
  const sections: Omit<ResolvedDeckTextImport, "notFound" | "substitutedPrintings"> = {
    cards: [],
    sideboard: [],
    maybeboard: [],
    commanders: [],
  };
  const unresolved: ParsedDeckEntry[] = [];
  const reusedByEntry = entries.map(() => [] as DeckCard[]);
  for (const sameZone of [true, false]) {
    for (const [index, entry] of entries.entries()) {
      if (!entry.setCode || !entry.collectorNumber) continue;
      const matches = pool.get(
        deckCardPrintingKey(entry.name, entry.setCode, entry.collectorNumber, entry.foil),
      );
      if (!matches) continue;
      const reused = reusedByEntry[index];
      const zone = deckImportEntryZone(entry);
      while (reused.length < entry.count) {
        const matchIndex = matches.findIndex((match) => !sameZone || match.zone === zone);
        if (matchIndex < 0) break;
        reused.push(matches.splice(matchIndex, 1)[0].card);
      }
    }
  }
  for (const [index, entry] of entries.entries()) {
    const reused = reusedByEntry[index];
    const zone = deckImportEntryZone(entry);
    const target =
      zone === "commander" && (entry.commander || reused.every((card) => isCommanderEligible(card)))
        ? sections.commanders
        : zone === "side"
          ? sections.sideboard
          : zone === "maybe"
            ? sections.maybeboard
            : sections.cards;
    target.push(...reused);
    if (reused.length < entry.count) {
      unresolved.push({ ...entry, count: entry.count - reused.length });
    }
  }
  return { sections, unresolved };
}
export function useDeckTextReplaceCurrent() {
  return useCallback(
    async (
      entries: ParsedDeckEntry[],
      _name: string,
      _formatId: DeckFormat | undefined,
      onProgress: (fraction: number) => void,
      _source: "text" | "clipboard" = "text",
      text?: string,
    ): Promise<boolean> => {
      const { currentDeck, editorSessionId: startingSessionId } = useDeckStore.getState();
      if (text !== undefined) {
        const parsed = parseDeckListTextReview(text);
        if (
          parsed.unrecognizedLines.length > 0 ||
          (text.trim().length > 0 && parsed.entries.length === 0 && !parsed.hasSections)
        ) {
          throw new Error("No changes applied. Fix unrecognized lines before replacing the deck.");
        }
        entries = parsed.entries;
      }
      if (
        entries.some(
          (entry) => !entry.name.trim() || !Number.isSafeInteger(entry.count) || entry.count <= 0,
        )
      ) {
        throw new Error(
          "No changes applied. Every card needs a name and a positive whole quantity.",
        );
      }
      const { sections, unresolved } = reuseCurrentDeckCards(currentDeck, entries);
      const resolved =
        unresolved.length > 0 ? await resolveDeckTextImport(unresolved, onProgress, true) : null;
      if (useDeckStore.getState().editorSessionId !== startingSessionId) {
        return false;
      }
      if (useDeckStore.getState().currentDeck !== currentDeck) {
        throw new Error(
          "The deck changed while checking this list. Reopen Edit as text and review it again.",
        );
      }
      if (resolved) {
        sections.cards.push(...resolved.cards);
        sections.sideboard.push(...resolved.sideboard);
        sections.maybeboard.push(...resolved.maybeboard);
        sections.commanders.push(...resolved.commanders);
      }
      executeDeckEdit(`Edit deck list`, () =>
        useDeckStore.getState().replaceCurrentDeckSections(sections),
      );
      onProgress(1);
      toast.success(`Deck updated`);
      return true;
    },
    [],
  );
}
