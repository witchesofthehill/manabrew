/**
 * What an offline game leaves behind: the same fields the hosted node recorded
 * for these games before Play vs AI moved into the browser, reported to the hub
 * so they land in the same tables. Unlike the engine timings next door in
 * `engineStatsReport`, this record names players.
 *
 * Seats are assembled at launch, not at game over, because the deck fingerprint
 * is async and a game can end on `pagehide` with nothing left to await.
 */
import { HubRequestError, recordOfflineGame } from "@/api/hub";
import { getDeckEvidenceFingerprint } from "@/lib/deckFingerprint";
import { APP_VERSION, STORAGE_KEYS } from "@/lib/constants";
import { getPlatform } from "@/platform";
import type { Deck } from "@/protocol";

const MAX_PENDING = 100;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_FLUSH = 20;
/** Keep in sync with the hub's own cap in `telemetry.rs`. */
const MAX_CARDS_PER_SEAT = 400;

let flushing: Promise<void> | null = null;

export interface OfflinePlayCard {
  name: string;
  setCode: string;
  count: number;
}

export interface OfflinePlaySeat {
  username: string;
  isBot: boolean;
  deckName?: string;
  commander?: string;
  publishedDeckId?: string;
  deckFingerprint?: string;
  sideboardCount: number;
  cards: OfflinePlayCard[];
}

export interface OfflinePlayGame {
  reportId: string;
  startedAt: string;
  endedAt: string;
  durationS: number;
  format?: string;
  engine: string;
  startingLife: number;
  /** The relay's vocabulary, not the client's: `game_over` or `abandoned`. */
  endReason: string;
  gameOver: boolean;
  winner?: string;
  conceded: string[];
  clientVersion: string;
  platform: string;
  players: OfflinePlaySeat[];
}

interface PendingRecord {
  game: OfflinePlayGame;
  queuedAt: number;
}

interface OpenGame {
  /**
   * Minted at launch rather than at game over, because it is the game's id and
   * not the report's: the engine timings next door are written by a different
   * caller at a different moment, and the two only meet in the analytics tables
   * if they agree on this before either of them runs.
   */
  reportId: string;
  startedAtMs: number;
  engine: string;
  format: string | null;
  startingLife: number;
  decks: Map<string, Omit<OfflinePlaySeat, "username" | "isBot">>;
}

let open: OpenGame | null = null;

/**
 * Keep in sync with `analytics::aggregate_deck_cards` on the relay, or the two
 * paths disagree about the same decklist.
 */
export function aggregateDeckCards(deck: Deck): OfflinePlayCard[] {
  const counts = new Map<string, OfflinePlayCard>();
  for (const card of [...deck.cards, ...(deck.commanders ?? [])]) {
    const name = card.identity.name;
    const setCode = card.identity.setCode ?? "";
    const key = `${name} ${setCode}`;
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { name, setCode, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Never throws: a game must not fail to start because its telemetry did. */
export async function beginOfflineGame(meta: {
  engine: string;
  format: string | null;
  startingLife: number;
  decks: Record<string, Deck>;
  publishedDeckIds?: Record<string, string>;
}): Promise<void> {
  const decks = new Map<string, Omit<OfflinePlaySeat, "username" | "isBot">>();
  open = {
    reportId: crypto.randomUUID(),
    startedAtMs: Date.now(),
    engine: meta.engine,
    format: meta.format,
    startingLife: meta.startingLife,
    decks,
  };
  for (const [seatId, deck] of Object.entries(meta.decks)) {
    let deckFingerprint: string | undefined;
    try {
      deckFingerprint = await getDeckEvidenceFingerprint(deck);
    } catch {
      deckFingerprint = undefined;
    }
    const cards = aggregateDeckCards(deck);
    decks.set(seatId, {
      deckName: deck.name || undefined,
      commander: deck.commanders?.[0]?.identity.name,
      publishedDeckId: meta.publishedDeckIds?.[seatId],
      deckFingerprint,
      sideboardCount: deck.sideboard?.length ?? 0,
      // Dropped rather than truncated: half a decklist skews card counts.
      cards: cards.length <= MAX_CARDS_PER_SEAT ? cards : [],
    });
  }
}

/** Forget the open game without reporting it. */
export function abandonOfflineGame(): void {
  open = null;
}

/**
 * The id the open offline game will be filed under, for anything that wants to
 * point at the same game. Null once the game has been reported or when there
 * was never one, so read it before closing the book, not after.
 */
export function currentOfflineGameId(): string | null {
  return open?.reportId ?? null;
}

function loadPending(): PendingRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.OFFLINE_PLAY_RECORDS) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingRecord =>
        typeof item === "object" &&
        item !== null &&
        typeof item.queuedAt === "number" &&
        typeof item.game === "object" &&
        item.game !== null &&
        typeof item.game.reportId === "string",
    );
  } catch {
    return [];
  }
}

function savePending(records: PendingRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.OFFLINE_PLAY_RECORDS, JSON.stringify(records));
  } catch {
    // A full or blocked store is not worth failing a game over.
  }
}

/** Send what is queued. Stops at the first network failure and keeps the rest. */
export async function flushOfflinePlayRecords(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const cutoff = Date.now() - MAX_AGE_MS;
    let pending = loadPending().filter((record) => record.queuedAt >= cutoff);
    savePending(pending);
    for (const record of pending.slice(0, MAX_PER_FLUSH)) {
      try {
        await recordOfflineGame(record.game);
        pending = pending.filter((item) => item.game.reportId !== record.game.reportId);
        savePending(pending);
      } catch (error) {
        // A refusal will never turn into an acceptance; anything else might.
        if (error instanceof HubRequestError && (error.status === 404 || error.status === 422)) {
          pending = pending.filter((item) => item.game.reportId !== record.game.reportId);
          savePending(pending);
          continue;
        }
        break;
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export interface OfflineSeatOutcome {
  seatId: string;
  username: string;
  isBot: boolean;
  conceded: boolean;
}

/**
 * Close the book on an offline game. Never throws and never blocks the caller.
 * Draining `open` is what makes it safe to call twice, which game over and
 * teardown both do.
 */
export function reportOfflineGame(meta: {
  gameOver: boolean;
  winner: string | null;
  seats: OfflineSeatOutcome[];
}): void {
  const game = open;
  if (!game) return;
  open = null;
  if (meta.seats.length === 0) return;
  try {
    const endedAtMs = Date.now();
    const record: OfflinePlayGame = {
      reportId: game.reportId,
      startedAt: new Date(game.startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationS: Math.round((endedAtMs - game.startedAtMs) / 1000),
      format: game.format ?? undefined,
      engine: game.engine,
      startingLife: game.startingLife,
      endReason: meta.gameOver ? "game_over" : "abandoned",
      gameOver: meta.gameOver,
      winner: meta.winner ?? undefined,
      conceded: meta.seats.filter((seat) => seat.conceded).map((seat) => seat.username),
      clientVersion: APP_VERSION,
      platform: getPlatform().type,
      players: meta.seats.map((seat) => ({
        username: seat.username,
        isBot: seat.isBot,
        sideboardCount: 0,
        cards: [],
        ...game.decks.get(seat.seatId),
      })),
    };
    const pending = [...loadPending(), { game: record, queuedAt: Date.now() }].slice(-MAX_PENDING);
    savePending(pending);
    void flushOfflinePlayRecords();
  } catch {
    return;
  }
}
