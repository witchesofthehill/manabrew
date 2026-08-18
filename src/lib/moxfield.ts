// Pure Moxfield client. No React, no Node. Mirrors archidekt.ts.
// Only direct deck fetch by public ID is supported — search is intentionally
// omitted because Moxfield's public search ignores the query param.

import type {
  ArchidektDeck,
  ArchidektDeckCard,
  ArchidektSearchResult,
  RequestOptions,
} from "./archidekt";

const USER_AGENT = "manabrew-deck-importer";

function resolveFetch(opts?: RequestOptions): typeof fetch {
  const f = opts?.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error("No fetch implementation available");
  return f;
}

export function parseMoxfieldUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i.exec(trimmed);
  return match ? match[1] : null;
}

interface RawMoxfieldBoardEntry {
  quantity: number;
  card?: {
    name?: string;
    color_identity?: string[];
    set?: string;
    cn?: string;
  };
}

interface RawMoxfieldDeck {
  publicId: string;
  name: string;
  description?: string | null;
  format?: string;
  colors?: string[];
  colorIdentity?: string[];
  createdByUser?: { userName?: string };
  mainboard?: Record<string, RawMoxfieldBoardEntry>;
  commanders?: Record<string, RawMoxfieldBoardEntry>;
  signatureSpells?: Record<string, RawMoxfieldBoardEntry>;
  sideboard?: Record<string, RawMoxfieldBoardEntry>;
  maybeboard?: Record<string, RawMoxfieldBoardEntry>;
}

function normalizeDescription(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

function collectBoard(
  board: Record<string, RawMoxfieldBoardEntry> | undefined,
  colors: Set<string>,
): ArchidektDeckCard[] {
  if (!board) return [];
  const out: ArchidektDeckCard[] = [];
  for (const [key, entry] of Object.entries(board)) {
    const name = entry.card?.name ?? key;
    if (!name) continue;
    out.push({
      name,
      count: entry.quantity,
      set: entry.card?.set?.toLowerCase(),
      cardNumber: entry.card?.cn,
    });
    for (const c of entry.card?.color_identity ?? []) colors.add(c);
  }
  return out;
}

export async function fetchMoxfieldDeck(
  publicId: string,
  opts: RequestOptions = {},
): Promise<ArchidektDeck> {
  const fetchFn = resolveFetch(opts);
  const res = await fetchFn(`https://api2.moxfield.com/v2/decks/all/${publicId}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Moxfield fetch failed: ${res.status}`);
  const data = (await res.json()) as RawMoxfieldDeck;
  const colors = new Set<string>();
  const cards = collectBoard(data.mainboard, colors);
  const commanders = collectBoard(data.commanders, colors);
  const signatureSpells = collectBoard(data.signatureSpells, colors);
  return {
    id: data.publicId,
    name: data.name,
    description: typeof data.description === "string" ? data.description : "",
    colors: data.colorIdentity ?? data.colors ?? [...colors],
    cards,
    commanders,
    signatureSpells,
  };
}

export async function fetchMoxfieldResult(
  publicId: string,
  opts: RequestOptions = {},
): Promise<ArchidektSearchResult> {
  const fetchFn = resolveFetch(opts);
  const res = await fetchFn(`https://api2.moxfield.com/v2/decks/all/${publicId}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Moxfield fetch failed: ${res.status}`);
  const d = (await res.json()) as RawMoxfieldDeck;
  return {
    id: d.publicId,
    name: d.name,
    author: d.createdByUser?.userName ?? "unknown",
    format: d.format ?? "",
    description: normalizeDescription(d.description),
    tags: [],
  };
}
