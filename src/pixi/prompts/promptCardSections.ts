import type { CardDto, ZoneKind } from "@/protocol/game";

export interface PromptCardSection {
  label: string | null;
  indices: number[];
}

const ZONE_SECTION_LABELS: Record<ZoneKind, string> = {
  sideboard: "SIDEBOARD",
  hand: "HAND",
  battlefield: "BATTLEFIELD",
  graveyard: "GRAVEYARD",
  library: "LIBRARY",
  exile: "EXILE",
  command: "COMMAND ZONE",
  attractions: "ATTRACTIONS",
  junkyard: "JUNKYARD",
};

const ZONE_SECTION_ORDER = Object.keys(ZONE_SECTION_LABELS) as ZoneKind[];

export function promptCardSections(cards: CardDto[], indices: number[]): PromptCardSection[] {
  const zones = new Set(cards.map((card) => card.zone));
  if (zones.size < 2 || zones.has(undefined)) return [{ label: null, indices }];
  return ZONE_SECTION_ORDER.flatMap((zone) => {
    const sectionIndices = indices.filter((index) => cards[index]!.zone === zone);
    return sectionIndices.length > 0
      ? [{ label: ZONE_SECTION_LABELS[zone], indices: sectionIndices }]
      : [];
  });
}
