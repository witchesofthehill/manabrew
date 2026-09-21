import type { CardDto } from "@/protocol/game";
import type { ClientCardDto, ClientGameView } from "@/stores/gameStore.types";

export type ZoneViewMode = "browse" | "cast" | "target" | "cost" | "manual";
export type ViewableZone = "hand" | "graveyard" | "exile" | "commandZone" | "library";
export interface ZoneLocation {
  playerId: string;
  zone: ViewableZone;
}
const ZONES: ViewableZone[] = ["hand", "graveyard", "exile", "commandZone", "library"];

export function locateVisibleZone(
  cards: CardDto[],
  view: ClientGameView | null,
): ZoneLocation | undefined {
  if (!view) return;
  for (const player of view.players) {
    for (const zone of ZONES) {
      const visible = player[zone];
      if (
        visible === cards ||
        (cards.length > 0 && visible.some((card) => card.id === cards[0].id))
      )
        return { playerId: player.id, zone };
    }
  }
}

export function visibleZoneCards(location: ZoneLocation, view: ClientGameView): ClientCardDto[] {
  return view.players.find((player) => player.id === location.playerId)?.[location.zone] ?? [];
}

export function zoneLocationKey(location: ZoneLocation | undefined, title: string): string {
  return location ? `${location.playerId}:${location.zone}` : title;
}
