import type { DeckCard } from "@/protocol/deck";
import type { DeckOwnershipStatus } from "@/lib/collection";

interface DeckQueryContext {
  tags: string[];
  unsupported: boolean;
  ownership?: DeckOwnershipStatus;
  section?: "main" | "sideboard" | "maybeboard" | "special";
  combo?: boolean;
  gameChanger?: boolean;
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

  return clauses.every((rawClause) => {
    const negated = rawClause.startsWith("-");
    const clause = negated ? rawClause.slice(1) : rawClause;
    const matches = (() => {
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
      if (clause.startsWith("section:")) return context.section === clause.slice(8);
      if (clause === "is:foil") return !!card.identity.foil;
      if (clause === "is:unsupported") return context.unsupported;
      if (clause === "is:combo") return !!context.combo;
      if (clause === "is:game-changer") return !!context.gameChanger;
      if (clause === "is:owned") return context.ownership !== "missing";
      if (clause === "is:missing") return context.ownership === "missing";
      if (clause === "is:partial") return context.ownership === "partial";
      if (clause === "is:exact-printing") return context.ownership === "exact";
      if (clause === "is:other-printing") return context.ownership === "other";
      const manaValue = clause.match(/^mv(<=|>=|=|<|>)(\d+)$/);
      if (manaValue) return compareNumber(card.cmc ?? 0, manaValue[1], Number(manaValue[2]));
      return clause.split(",").some((term) => card.identity.name.toLowerCase().includes(term));
    })();
    return negated ? !matches : matches;
  });
}
