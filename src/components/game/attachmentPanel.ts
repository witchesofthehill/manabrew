import type { CardDto } from "@/protocol/game";
import type { ClientPlayerDto } from "@/stores/gameStore.types";
import type { BoardCanvasRegion } from "@/pixi/BoardCanvas";
import { stripUsernameTag } from "@/lib/username";

export interface AttachmentReference {
  card: CardDto;
  target: CardDto | null;
  playerId: string | null;
}

export interface AttachmentSection {
  playerId: string;
  title: string;
  cards: AttachmentReference[];
}

export type AttachmentSort = "attachee" | "attachment";

export interface AttachmentGroup {
  key: string;
  title: string;
  cards: AttachmentReference[];
}

export function groupAttachments(
  cards: readonly AttachmentReference[],
  sortBy: AttachmentSort,
): AttachmentGroup[] {
  const groups = new Map<string, AttachmentGroup>();
  for (const reference of cards) {
    const byTarget = sortBy === "attachee" && reference.card.attachedTo;
    const key = JSON.stringify(
      byTarget
        ? ["attachee", reference.card.attachedTo]
        : ["attachment", reference.card.identity.name],
    );
    const title = byTarget
      ? (reference.target?.identity.name ?? "Target unavailable")
      : reference.card.identity.name;
    const group = groups.get(key);
    if (group) group.cards.push(reference);
    else groups.set(key, { key, title, cards: [reference] });
  }
  const secondaryName = (reference: AttachmentReference) =>
    sortBy === "attachee" ? reference.card.identity.name : (reference.target?.identity.name ?? "");
  for (const group of groups.values()) {
    group.cards.sort(
      (a, b) =>
        secondaryName(a).localeCompare(secondaryName(b)) || a.card.id.localeCompare(b.card.id),
    );
  }
  return [...groups.values()].sort(
    (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
}

export function attachmentKind(card: CardDto): "equipment" | "aura" | "other" {
  if (card.subtypes.includes("Equipment")) return "equipment";
  if (card.subtypes.includes("Aura") || card.isBestowed) return "aura";
  return "other";
}

export function buildAttachmentSections(
  battlefield: readonly CardDto[],
  regions: readonly Pick<BoardCanvasRegion, "playerId" | "state">[],
  localPlayerId: string,
  players: readonly Pick<ClientPlayerDto, "id" | "name">[],
): AttachmentSection[] {
  const byId = new Map(battlefield.map((card) => [card.id, card]));
  const displayedOn = new Map(
    regions.flatMap((region) =>
      region.state.cards.map((card) => [card.id, region.playerId] as const),
    ),
  );
  const sections: AttachmentSection[] = players.map((player) => ({
    playerId: player.id,
    title: player.id === localPlayerId ? "Your Board" : `${stripUsernameTag(player.name)}'s Board`,
    cards: [],
  }));
  const byPlayer = new Map(sections.map((section) => [section.playerId, section]));
  for (const card of battlefield) {
    if (
      card.controllerId !== localPlayerId ||
      card.isFaceDown ||
      ("visibility" in card && card.visibility === "hidden") ||
      (!card.attachedTo &&
        attachmentKind(card) === "other" &&
        !card.subtypes.includes("Fortification"))
    )
      continue;
    const target = card.attachedTo ? (byId.get(card.attachedTo) ?? null) : null;
    let host = card;
    const seen = new Set<string>();
    while (host.attachedTo && byId.has(host.attachedTo) && !seen.has(host.id)) {
      seen.add(host.id);
      host = byId.get(host.attachedTo)!;
    }
    const section = byPlayer.get(host.controllerId);
    if (!section) continue;
    section.cards.push({
      card,
      target,
      playerId:
        card.phasedOut || target?.phasedOut || host.phasedOut
          ? null
          : (displayedOn.get(target?.id ?? card.id) ?? null),
    });
  }
  return sections.filter((section) => section.cards.length > 0);
}
