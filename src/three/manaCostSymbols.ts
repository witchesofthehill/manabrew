export function manaCostSymbols(cost: string) {
  if (!cost.trim() || cost.trim().toLowerCase() === "no cost") return [];
  return cost.includes("{")
    ? Array.from(cost.matchAll(/\{([^{}]+)\}/g), (match) => match[1].trim().toUpperCase())
    : cost.trim().toUpperCase().split(/\s+/);
}
