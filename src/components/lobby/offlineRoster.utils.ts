import { getFormat, validateDeckSections, type CardPool } from "@/lib/formats";
import type { SelectedDeck } from "./deckSelection.types";
import type { OfflineRosterState } from "./offlineRoster.state";

export function isOfflinePodFormat(formatId: string | null | undefined): boolean {
  return formatId === "commander" || formatId === "paupercommander";
}

export function offlineSelectionError(
  selected: SelectedDeck | null,
  formatId: string | null,
  cardPool: CardPool,
): string | undefined {
  if (!selected) return "Choose a deck";
  if (selected.formatId !== formatId) return "Choose a deck for this format";
  const format = getFormat(selected.formatId ?? "standard");
  if (!format) return "Unsupported format";
  return validateDeckSections(
    { deck: selected.sourceDeck, commanderName: selected.commanderName },
    format,
    cardPool,
  ).errors[0];
}

export function prepareOfflineGame(
  roster: OfflineRosterState,
  formatId: string | null,
  cardPool: CardPool,
) {
  const errors = roster.seats.map((seat) => offlineSelectionError(seat.deck, formatId, cardPool));
  const ready = errors.every((error) => !error);
  return {
    errors,
    launch: ready
      ? {
          playerDeck: roster.seats[0].deck!,
          opponentDecks: roster.seats.slice(1).map((seat) => seat.deck!.sourceDeck),
        }
      : null,
  };
}
