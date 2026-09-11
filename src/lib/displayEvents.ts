import type { DisplayEvent } from "@/protocol/display";

import { presentDisplayEventAudio, resetDisplayEventAudioSession } from "./displayEventAudio";

type CardPlayDisplayEvent = DisplayEvent & {
  eventType: "game.card.play";
  origin: { type: "card"; cardId: string };
  context: Extract<NonNullable<DisplayEvent["context"]>, { kind: "card" }>;
};

type TurnStartDisplayEvent = DisplayEvent & {
  eventType: "game.turn.start";
  origin: { type: "player"; playerId: string };
  context: Extract<NonNullable<DisplayEvent["context"]>, { kind: "turn" }>;
};

let lastSequence: number | null = null;

export function presentDisplayEvent(event: DisplayEvent): boolean {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return false;
  if (lastSequence !== null && event.sequence <= lastSequence) return false;

  lastSequence = event.sequence;
  presentDisplayEventAudio(event);
  return true;
}

export function isCardPlayDisplayEvent(event: DisplayEvent): event is CardPlayDisplayEvent {
  return (
    event.eventType === "game.card.play" &&
    event.origin?.type === "card" &&
    event.context?.kind === "card"
  );
}

export function isTurnStartDisplayEvent(event: DisplayEvent): event is TurnStartDisplayEvent {
  return (
    event.eventType === "game.turn.start" &&
    event.origin?.type === "player" &&
    event.context?.kind === "turn"
  );
}

export function hasVisualDisplayPresentation(event: DisplayEvent): boolean {
  return isCardPlayDisplayEvent(event) || isTurnStartDisplayEvent(event);
}

export function resetDisplayEventSession(): void {
  lastSequence = null;
  resetDisplayEventAudioSession();
}
