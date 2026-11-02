import type { FlashItem } from "@/components/game/game.types";
import { stackObjectToCard } from "@/components/game/game.utils";
import type { ZoneKind } from "@/protocol/game";
import type { ClientCardDto, ClientGameView } from "@/stores/gameStore.types";

export type GameViewTransition =
  | { kind: "cardPlay"; card: ClientCardDto | null }
  | { kind: "turnStart"; playerId: string }
  | {
      kind:
        | "cardTap"
        | "cardUntap"
        | "cardAttach"
        | "cardTransform"
        | "tokenCreate"
        | "cardDiscard"
        | "cardDestroy"
        | "cardExile"
        | "cardCounterAdd"
        | "cardCounterRemove"
        | "cardDamage"
        | "instantResolve"
        | "sorceryResolve"
        | "lifeGain"
        | "lifeLoss"
        | "combatBlock"
        | "outcomeWin"
        | "outcomeLoss";
    };

function cardLocations(view: ClientGameView): Map<string, ZoneKind | "stack"> {
  const locations = new Map<string, ZoneKind | "stack">();
  for (const item of view.stack) locations.set(item.sourceId, "stack");
  for (const zone of view.zones) {
    for (const card of zone.cards) locations.set(card.id, zone.zone);
  }
  return locations;
}

function counterTotal(card: ClientCardDto | undefined): number {
  return Object.values(card?.counters ?? {}).reduce((total, count) => total + count, 0);
}

function completesRestore(previous: ClientGameView, next: ClientGameView): boolean {
  const vote = next.restoreVote;
  if (vote?.status.type !== "approved") return false;
  const before = previous.restoreVote;
  return before?.voteId !== vote.voteId || before.status.type !== "approved";
}

export function gameViewTransitions(
  previous: ClientGameView | null,
  next: ClientGameView,
  myPlayerId: string | null,
): GameViewTransition[] {
  if (!previous || previous.gameId !== next.gameId || completesRestore(previous, next)) return [];

  const transitions: GameViewTransition[] = [];
  const previousPlayers = new Map(previous.players.map((player) => [player.id, player]));
  const nextPlayers = new Map(next.players.map((player) => [player.id, player]));
  const previousLocations = cardLocations(previous);
  const nextLocations = cardLocations(next);
  const previousBattlefield = new Map(previous.battlefield.map((card) => [card.id, card]));

  const handShrank = (playerId: string) =>
    (nextPlayers.get(playerId)?.handCount ?? 0) < (previousPlayers.get(playerId)?.handCount ?? 0);
  const landPlayed = (playerId: string) =>
    (nextPlayers.get(playerId)?.landsPlayedThisTurn ?? 0) >
    (previousPlayers.get(playerId)?.landsPlayedThisTurn ?? 0);

  if (next.turn !== previous.turn) {
    transitions.push({ kind: "turnStart", playerId: next.activePlayerId });
  }

  for (const player of next.players) {
    const before = previousPlayers.get(player.id);
    if (!before) continue;
    if (player.life > before.life) transitions.push({ kind: "lifeGain" });
    if (player.life < before.life) transitions.push({ kind: "lifeLoss" });
  }

  const previousStack = new Map(previous.stack.map((item) => [item.id, item]));
  for (const item of next.stack) {
    if (
      item.isCasting ||
      nextLocations.get(item.sourceId) !== "stack" ||
      previousLocations.get(item.sourceId) === "battlefield"
    ) {
      continue;
    }
    const before = previousStack.get(item.id);
    if (before && !before.isCasting) continue;
    transitions.push({ kind: "cardPlay", card: item.sourceCard ? stackObjectToCard(item) : null });
  }

  const nextStackIds = new Set(next.stack.map((item) => item.id));
  for (const item of previous.stack) {
    if (
      item.isCasting ||
      nextStackIds.has(item.id) ||
      previousLocations.get(item.sourceId) !== "stack"
    ) {
      continue;
    }
    const types = item.sourceCard?.types ?? [];
    if (types.includes("Instant")) transitions.push({ kind: "instantResolve" });
    else if (types.includes("Sorcery")) transitions.push({ kind: "sorceryResolve" });
  }

  for (const card of next.battlefield) {
    const before = previousBattlefield.get(card.id);
    if (before) {
      if (card.tapped !== before.tapped && !card.types.includes("Land")) {
        transitions.push({ kind: card.tapped ? "cardTap" : "cardUntap" });
      }
      if (card.isTransformed !== before.isTransformed) transitions.push({ kind: "cardTransform" });
    } else if (card.identity.isToken && !previousLocations.has(card.id)) {
      transitions.push({ kind: "tokenCreate" });
    } else if (card.types.includes("Land") && landPlayed(card.controllerId)) {
      transitions.push({ kind: "cardPlay", card });
    }
    if (card.attachedTo && card.attachedTo !== before?.attachedTo) {
      transitions.push({ kind: "cardAttach" });
    }
    const counterChange = counterTotal(card) - counterTotal(before);
    if (counterChange > 0) transitions.push({ kind: "cardCounterAdd" });
    if (counterChange < 0) transitions.push({ kind: "cardCounterRemove" });
    if (card.damage > (before?.damage ?? 0)) transitions.push({ kind: "cardDamage" });
  }

  for (const card of previous.battlefield) {
    if (card.identity.isToken && !nextLocations.has(card.id)) {
      transitions.push({ kind: "cardDestroy" });
    }
  }

  for (const zone of next.zones) {
    if (zone.zone !== "graveyard" && zone.zone !== "exile") continue;
    for (const card of zone.cards) {
      const from = previousLocations.get(card.id);
      if (from === zone.zone) continue;
      if (zone.zone === "exile") {
        transitions.push({ kind: "cardExile" });
      } else if (from === "battlefield") {
        transitions.push({ kind: "cardDestroy" });
      } else if (from === "hand" || (from === undefined && handShrank(zone.ownerId))) {
        transitions.push({ kind: "cardDiscard" });
      }
    }
  }

  const previousBlocks = new Set(
    previous.combatAssignments.map((block) => `${block.blockerId}:${block.attackerId}`),
  );
  if (
    next.combatAssignments.some(
      (block) => !previousBlocks.has(`${block.blockerId}:${block.attackerId}`),
    )
  ) {
    transitions.push({ kind: "combatBlock" });
  }

  if (next.gameOver && !previous.gameOver && myPlayerId) {
    transitions.push({ kind: next.winnerId === myPlayerId ? "outcomeWin" : "outcomeLoss" });
  }

  return transitions;
}

export function flashItemOf(transition: GameViewTransition): FlashItem | null {
  if (transition.kind === "cardPlay") {
    return transition.card ? { kind: "card", card: transition.card } : null;
  }
  if (transition.kind === "turnStart") return { kind: "turn", playerId: transition.playerId };
  return null;
}
