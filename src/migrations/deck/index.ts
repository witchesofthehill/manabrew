import { VERSION } from "@/protocol";
import { migrate as to_0_2_0 } from "./0.2.0";
import { backfill as backfill_1_1_0 } from "./1.1.0";
import type { DeckEnrichmentApi } from "./1.1.0";

type AnyRecord = Record<string, unknown>;

const MIGRATIONS: ReadonlyArray<{
  version: string;
  migrate?: (deck: AnyRecord) => AnyRecord;
  backfill?: (api: DeckEnrichmentApi) => Promise<void>;
}> = [
  { version: "0.2.0", migrate: to_0_2_0 },
  { version: "1.1.0", backfill: backfill_1_1_0 },
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
    if (migrate && compareVersions(version, from) > 0) result = migrate(result);
  }
  return { ...result, version: VERSION } as T;
}

let backfillsStarted = false;

/** The async half of migration: steps that need remote data run once per app
 *  start, after hydration, over every stored deck. */
export async function completeDeckMigrations(api: DeckEnrichmentApi): Promise<void> {
  if (backfillsStarted) return;
  backfillsStarted = true;
  for (const { backfill } of MIGRATIONS) {
    if (backfill) await backfill(api);
  }
}
