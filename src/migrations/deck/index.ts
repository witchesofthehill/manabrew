import { VERSION } from "@/protocol";
import { migrate as to_0_2_0 } from "./0.2.0";

type AnyRecord = Record<string, unknown>;

const MIGRATIONS: ReadonlyArray<{ version: string; migrate: (deck: AnyRecord) => AnyRecord }> = [
  { version: "0.2.0", migrate: to_0_2_0 },
];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function migrateDeck<T extends { version?: string }>(deck: T): T {
  if (!deck || typeof deck !== "object") return deck;
  const from = deck.version ?? "0.0.0";
  let result: AnyRecord = deck as AnyRecord;
  for (const { version, migrate } of MIGRATIONS) {
    if (compareVersions(version, from) > 0) result = migrate(result);
  }
  return { ...result, version: VERSION } as T;
}
