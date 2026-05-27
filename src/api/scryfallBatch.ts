import type { ScryfallCard } from "@/types/scryfall";
import { COLLECTION_BATCH_SIZE, SCRYFALL_API, scryfallFetch } from "./scryfall";

const SCRYFALL_BATCH_DEBOUNCE_MS = 100;

export type CardIdentifier =
  | { id: string }
  | { mtgo_id: number }
  | { multiverse_id: number }
  | { oracle_id: string }
  | { illustration_id: string }
  | { name: string; set?: string }
  | { set: string; collector_number: string };

interface PendingBatchItem {
  identifier: CardIdentifier;
  promise: Promise<ScryfallCard>;
  resolve: (card: ScryfallCard) => void;
  reject: (err: unknown) => void;
}

let pendingBatch = new Map<string, PendingBatchItem>();
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

function identifierKey(id: CardIdentifier): string {
  if ("id" in id) return `id:${id.id}`;
  if ("mtgo_id" in id) return `mtgo:${id.mtgo_id}`;
  if ("multiverse_id" in id) return `mv:${id.multiverse_id}`;
  if ("oracle_id" in id) return `oracle:${id.oracle_id}`;
  if ("illustration_id" in id) return `illustration:${id.illustration_id}`;
  if ("collector_number" in id) {
    return `cn:${id.set.toLowerCase()}::${id.collector_number.toLowerCase()}`;
  }
  return id.set
    ? `name:${id.name.toLowerCase()}::set:${id.set.toLowerCase()}`
    : `name:${id.name.toLowerCase()}`;
}

export function matchesIdentifier(card: ScryfallCard, id: CardIdentifier): boolean {
  if ("id" in id) return card.id === id.id;
  if ("mtgo_id" in id) return card.mtgo_id === id.mtgo_id || card.mtgo_foil_id === id.mtgo_id;
  if ("multiverse_id" in id) return card.multiverse_ids?.includes(id.multiverse_id) ?? false;
  if ("oracle_id" in id) return card.oracle_id === id.oracle_id;
  if ("illustration_id" in id) return card.illustration_id === id.illustration_id;
  if ("collector_number" in id) {
    return (
      card.set?.toLowerCase() === id.set.toLowerCase() &&
      card.collector_number?.toLowerCase() === id.collector_number.toLowerCase()
    );
  }
  const expectedName = id.name.toLowerCase();
  const cardName = card.name.toLowerCase();
  const faceMatches = card.card_faces?.some((face) => face.name.toLowerCase() === expectedName);
  const splitNameMatches = cardName
    .split(/\s+\/\/\s+/)
    .some((part) => part.toLowerCase() === expectedName);
  if (cardName !== expectedName && !faceMatches && !splitNameMatches) return false;
  return id.set ? card.set?.toLowerCase() === id.set.toLowerCase() : true;
}

// Scryfall's /cards/collection matches `name` against a single face — the
// full DFC display name returns not_found. Strip the back-face half before
// sending; matchesIdentifier still accepts the full name on the way back.
export function normalizeIdentifierForRequest(id: CardIdentifier): CardIdentifier {
  if ("name" in id && id.name.includes("//")) {
    const front = id.name.split(/\s*\/\/\s*/)[0]?.trim();
    if (front) return { ...id, name: front };
  }
  return id;
}

async function flushScryfallBatch(): Promise<void> {
  batchFlushTimer = null;
  const items = Array.from(pendingBatch.values());
  pendingBatch = new Map();
  for (let i = 0; i < items.length; i += COLLECTION_BATCH_SIZE) {
    const slice = items.slice(i, i + COLLECTION_BATCH_SIZE);
    const identifiers = slice.map((it) => normalizeIdentifierForRequest(it.identifier));
    try {
      const data = await scryfallFetch<{ data: ScryfallCard[]; not_found: unknown[] }>(
        `${SCRYFALL_API}/cards/collection`,
        "Failed to fetch card collection from Scryfall",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers }),
        },
      );
      for (const item of slice) {
        const found = data.data.find((c) => matchesIdentifier(c, item.identifier));
        if (found) item.resolve(found);
        else
          item.reject(new Error(`Card not found in collection: ${identifierKey(item.identifier)}`));
      }
    } catch (err) {
      for (const item of slice) item.reject(err);
    }
  }
}

export function enqueueCardLookup(identifier: CardIdentifier): Promise<ScryfallCard> {
  let resolve!: (card: ScryfallCard) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<ScryfallCard>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingBatch.set(identifierKey(identifier), { identifier, promise, resolve, reject });
  if (!batchFlushTimer) {
    batchFlushTimer = setTimeout(() => {
      void flushScryfallBatch();
    }, SCRYFALL_BATCH_DEBOUNCE_MS);
  }
  return promise;
}
