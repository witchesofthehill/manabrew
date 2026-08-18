import type { EditableDeckZone } from "@/components/editor/deckEditor.actions";

export interface DeckQuickAddRequest {
  query: string;
  quantity: number;
  destination: EditableDeckZone;
  tags: string[];
}

const DESTINATIONS: Record<string, EditableDeckZone> = {
  main: "main",
  deck: "main",
  side: "side",
  sideboard: "side",
  maybe: "maybe",
  maybeboard: "maybe",
};

export function parseDeckQuickAdd(value: string): DeckQuickAddRequest {
  let query = value.trim();
  let quantity = 1;
  let destination: EditableDeckZone = "main";
  const tags: string[] = [];

  const quantityMatch = query.match(/^(\d+)\s*(?:[x×]\s*)?/i);
  if (quantityMatch) {
    quantity = Math.max(1, Math.min(Number(quantityMatch[1]), 99));
    query = query.slice(quantityMatch[0].length).trim();
  }

  query = query.replace(/>(main|deck|side|sideboard|maybe|maybeboard)\b/gi, (_, zone: string) => {
    destination = DESTINATIONS[zone.toLowerCase()];
    return " ";
  });

  query = query.replace(/#(?:"([^"]+)"|([^\s#>]+))/g, (_, quoted: string, plain: string) => {
    const tag = (quoted ?? plain).trim();
    if (tag && !tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag);
    }
    return " ";
  });

  return {
    query: query.replace(/\s+/g, " ").trim(),
    quantity,
    destination,
    tags,
  };
}
