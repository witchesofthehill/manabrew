import { getFormat, validateDeckSections, type CardPool } from "@/lib/formats";
import type { SelectedDeck } from "./deckSelection.types";
import type { OfflineRosterState } from "./offlineRoster.state";

export function isOfflinePodFormat(formatId: string | null | undefined): boolean {
  return formatId === "commander" || formatId === "paupercommander";
}

function offlineLaunchError(
  selected: SelectedDeck | null,
  formatId: string | null,
): string | undefined {
  if (!selected) return "Choose a deck";
  if (selected.formatId !== formatId) return "Choose a deck for this format";
  if (!getFormat(selected.formatId ?? "standard")) return "Unsupported format";
  return undefined;
}

export function offlineSelectionError(
  selected: SelectedDeck | null,
  formatId: string | null,
  cardPool: CardPool,
): string | undefined {
  const launchError = offlineLaunchError(selected, formatId);
  if (launchError || !selected) return launchError;
  return validateDeckSections(
    { deck: selected.sourceDeck, commanderName: selected.commanderName },
    getFormat(selected.formatId ?? "standard")!,
    cardPool,
  ).errors[0];
}

export function prepareOfflineGame(
  roster: OfflineRosterState,
  formatId: string | null,
  cardPool: CardPool,
) {
  const errors = roster.seats.map((seat) => offlineSelectionError(seat.deck, formatId, cardPool));
  const ready = roster.seats.every((seat) => !offlineLaunchError(seat.deck, formatId));
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
