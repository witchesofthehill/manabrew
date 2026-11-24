import type { SelectedDeck } from "@/components/lobby/deckSelection.types";
import type { Deck } from "@/protocol/deck";
import type { AiController, EngineKind } from "@/types/server";
import type { GameRuntimeKind } from "./runtime.types";
import { getFormat } from "@/lib/formats";

export interface SinglePlayerSetup {
  seats: { id: string; deck: SelectedDeck }[];
  formatId: string;
  engine: EngineKind;
  runtimeKind?: GameRuntimeKind;
  aiController?: AiController;
  forgeAiRewind?: boolean;
}

export function singlePlayerDeck(
  deck: Deck,
  source: SelectedDeck["source"] = "snapshot",
  sourceId = deck.id ?? crypto.randomUUID(),
): SelectedDeck {
  return {
    id: `${source}:${sourceId}`,
    sourceId,
    name: deck.name,
    desc: deck.description,
    color: deck.color,
    sourceDeck: deck,
    source,
    formatId: deck.format ?? "standard",
    commanderName: deck.commanders?.[0]?.identity.name,
    coverCardName: deck.coverCardName,
  };
}

export function createSinglePlayerSetup({
  deck,
  opponentDecks,
  formatId,
  commanderName,
  engine,
  runtimeKind,
  aiController,
}: {
  deck: Deck;
  opponentDecks: Deck[];
  formatId: string;
  commanderName?: string;
  engine: EngineKind;
  runtimeKind?: GameRuntimeKind;
  aiController?: AiController;
}): SinglePlayerSetup {
  const deckFormatId = getFormat(formatId)?.deckFormat ?? formatId;
  const playerDeck = singlePlayerDeck(deck);
  return {
    seats: [
      {
        id: "player",
        deck: {
          ...playerDeck,
          formatId: deckFormatId,
          commanderName: commanderName ?? playerDeck.commanderName,
        },
      },
      ...opponentDecks.map((opponentDeck, index) => ({
        id: `bot-${index + 1}`,
        deck: { ...singlePlayerDeck(opponentDeck), formatId: deckFormatId },
      })),
    ],
    formatId,
    engine,
    runtimeKind,
    aiController,
  };
}
