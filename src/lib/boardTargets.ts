import type { ChooseBoardTargetsInput } from "@/protocol";
import type { CardDto, GameViewDto } from "@/protocol/game";

/** Candidates from a `chooseBoardTargets` prompt, partitioned into the surfaces
 *  the UI renders them on. Card candidates on the battlefield highlight in place;
 *  card candidates in another (public) zone surface in a modal grid; spells
 *  highlight on the stack; players light up their avatar. The split is derived
 *  from `gameView` — the prompt only carries ids + kind. */
export interface BoardTargetBuckets {
  playerIds: string[];
  battlefieldCardIds: string[];
  spellIds: string[];
  zone: { zone: string; cards: CardDto[]; validCardIds: string[] } | null;
}

function findInZones(gv: GameViewDto, id: string): { zone: string; card: CardDto } | null {
  for (const p of gv.players) {
    const zones: [string, CardDto[] | undefined][] = [
      ["Graveyard", p.graveyard],
      ["Exile", p.exile],
      ["Hand", p.hand],
      ["Command", p.commandZone],
    ];
    for (const [zone, list] of zones) {
      const card = list?.find((c) => c.id === id);
      if (card) return { zone, card };
    }
  }
  return null;
}

export function partitionBoardTargets(
  input: ChooseBoardTargetsInput,
  gameView: GameViewDto | null,
): BoardTargetBuckets {
  const playerIds: string[] = [];
  const battlefieldCardIds: string[] = [];
  const spellIds: string[] = [];
  const zoneCards: CardDto[] = [];
  const zoneValidIds: string[] = [];
  let zoneName = "";
  for (const c of input.candidates) {
    if (c.kind === "player") {
      playerIds.push(c.id);
    } else if (c.kind === "spell") {
      spellIds.push(c.id);
    } else if (gameView?.battlefield.some((b) => b.id === c.id)) {
      battlefieldCardIds.push(c.id);
    } else {
      const found = gameView ? findInZones(gameView, c.id) : null;
      if (found) {
        zoneName = found.zone;
        zoneCards.push(found.card);
        zoneValidIds.push(c.id);
      } else {
        battlefieldCardIds.push(c.id);
      }
    }
  }
  return {
    playerIds,
    battlefieldCardIds,
    spellIds,
    zone: zoneCards.length
      ? { zone: zoneName, cards: zoneCards, validCardIds: zoneValidIds }
      : null,
  };
}
