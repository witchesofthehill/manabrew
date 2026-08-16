import type { DeckCard } from "@/protocol/deck";

interface DeckQueryContext {
  tags: string[];
  unsupported: boolean;
}

function compareNumber(value: number, operator: string, target: number): boolean {
  if (operator === "<") return value < target;
  if (operator === "<=") return value <= target;
  if (operator === ">") return value > target;
  if (operator === ">=") return value >= target;
  return value === target;
}

export function matchesDeckQuery(
  card: DeckCard,
  query: string,
  context: DeckQueryContext,
): boolean {
  const clauses = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (clauses.length === 0) return true;

  return clauses.every((clause) => {
    if (clause.startsWith("tag:")) {
      const tag = clause.slice(4);
      return tag === "none"
        ? context.tags.length === 0
        : context.tags.some((candidate) => candidate.toLowerCase() === tag);
    }
    if (clause.startsWith("type:")) {
      const type = clause.slice(5);
      return [...card.types, ...(card.subtypes ?? [])].some((candidate) =>
        candidate.toLowerCase().includes(type),
      );
    }
    if (clause.startsWith("color:")) {
      const color = clause.slice(6);
      return (card.color ?? "").toLowerCase().includes(color);
    }
    if (clause === "is:foil") return !!card.identity.foil;
    if (clause === "is:unsupported") return context.unsupported;
    const manaValue = clause.match(/^mv(<=|>=|=|<|>)(\d+)$/);
    if (manaValue) return compareNumber(card.cmc ?? 0, manaValue[1], Number(manaValue[2]));
    return clause.split(",").some((term) => card.identity.name.toLowerCase().includes(term));
  });
}
