export interface CollectionCardIdentity {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
}

export type CollectionOwnership = "exact" | "other" | "none";

const collectionTotals = new WeakMap<Record<string, number>, Map<string, number>>();

function totalsByName(quantities: Record<string, number>): Map<string, number> {
  const cached = collectionTotals.get(quantities);
  if (cached) return cached;
  const totals = new Map<string, number>();
  for (const [cardKey, quantity] of Object.entries(quantities)) {
    const name = parseCollectionCardKey(cardKey).name.toLowerCase();
    totals.set(name, (totals.get(name) ?? 0) + quantity);
  }
  collectionTotals.set(quantities, totals);
  return totals;
}

export function collectionCardKey(
  name: string,
  setCode?: string,
  collectorNumber?: string,
  foil?: boolean,
): string {
  const normalizedName = name.trim().toLowerCase();
  if (!setCode?.trim() || !collectorNumber?.trim()) return normalizedName;
  const printingKey = `${normalizedName}::${setCode.trim().toLowerCase()}::${collectorNumber.trim().toLowerCase()}`;
  return foil === undefined ? printingKey : `${printingKey}::${foil ? "foil" : "nonfoil"}`;
}

export function parseCollectionCardKey(cardKey: string): CollectionCardIdentity {
  const parts = cardKey.split("::");
  if (parts.length < 3) return { name: cardKey };
  const finish = parts.at(-1);
  const foil = finish === "foil" ? true : finish === "nonfoil" ? false : undefined;
  if (foil !== undefined) parts.pop();
  const collectorNumber = parts.pop();
  const setCode = parts.pop();
  return { name: parts.join("::"), setCode, collectorNumber, foil };
}

export function collectionQuantityForName(
  quantities: Record<string, number>,
  name: string,
): number {
  const normalized = name.trim().toLowerCase();
  return Object.entries(quantities).reduce(
    (total, [cardKey, quantity]) =>
      parseCollectionCardKey(cardKey).name.toLowerCase() === normalized ? total + quantity : total,
    0,
  );
}

export function collectionOwnership(
  quantities: Record<string, number>,
  name: string,
  setCode?: string,
  collectorNumber?: string,
  foil?: boolean,
): CollectionOwnership {
  if (setCode && collectorNumber) {
    const exactKeys = foil
      ? [collectionCardKey(name, setCode, collectorNumber, true)]
      : [
          collectionCardKey(name, setCode, collectorNumber, false),
          collectionCardKey(name, setCode, collectorNumber),
        ];
    if (exactKeys.some((key) => (quantities[key] ?? 0) > 0)) return "exact";
  }
  return (totalsByName(quantities).get(name.trim().toLowerCase()) ?? 0) > 0 ? "other" : "none";
}
