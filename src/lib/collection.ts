export interface CollectionCardIdentity {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
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
