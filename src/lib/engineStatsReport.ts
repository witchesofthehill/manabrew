/**
 * Where a game's engine timings go once the game is over.
 *
 * Two routes, because the games worth measuring live in two different places.
 * A game the relay already knows about is reported over the relay, which files
 * it beside the rest of that room's analytics. Offline play has no server in
 * the loop at all, so it queues and goes to the hub — the same
 * queue-and-flush shape the deck play reports use, because a game can end with
 * no connection and the report should survive until there is one.
 *
 * Nothing here carries a deck, a card, an opponent or a name.
 */
import { recordEngineStats } from "@/api/hub";
import { HubRequestError } from "@/api/hub";
import { getPlatform } from "@/platform";
import { getSelectedGameRuntimeKind } from "@/game/runtimeRegistry";
import { isForgeWasmActive } from "@/lib/forgeWasm";
import { APP_VERSION, STORAGE_KEYS } from "@/lib/constants";
import type { EngineKind } from "@/types/server";
import type { EngineGameStats } from "@/lib/engineTelemetry";
import { summariseGame } from "@/lib/engineTelemetry";

const MAX_PENDING = 100;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_FLUSH = 20;
let flushing: Promise<void> | null = null;

interface PendingReport {
  stats: EngineGameStats;
  queuedAt: number;
}

/**
 * Which engine actually ran, for a game whose rules engine is in this process.
 *
 * The browser Forge build runs under the "manabrew" runtime — it is the local
 * engine, whatever the room calls it — so the label has to come from the engine
 * selection rather than the runtime kind, or every wasm game would be filed as
 * the Rust one.
 */
export function localEngineLabel(): string {
  const kind = getSelectedGameRuntimeKind();
  if (kind === "manabrew" && isForgeWasmActive()) return "forge-wasm";
  return kind;
}

/**
 * Forge, running outside this tab: on one of the hosted nodes, or on this
 * machine when the desktop build hosts the room itself.
 */
export function forgeHostLabel(onThisMachine: boolean): string {
  return onThisMachine ? "forge-desktop" : "forge-hosted";
}

/**
 * The engine behind a relay room. A local host can name the engine exactly;
 * other seats only know that Forge runs remotely.
 */
export function roomEngineLabel(
  engine: EngineKind | null | undefined,
  hostedHere: boolean,
  platform: "tauri" | "web",
): string {
  if (engine === "Forge") {
    if (!hostedHere) return "forge-remote";
    return platform === "tauri" ? "forge-desktop" : "forge-wasm";
  }
  if (engine === "Ironsmith") return "ironsmith";
  return localEngineLabel();
}

function loadPending(): PendingReport[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.ENGINE_STATS_REPORTS) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PendingReport =>
        typeof item === "object" &&
        item !== null &&
        typeof item.queuedAt === "number" &&
        typeof item.stats === "object" &&
        item.stats !== null &&
        typeof item.stats.reportId === "string",
    );
  } catch {
    return [];
  }
}

function savePending(reports: PendingReport[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS.ENGINE_STATS_REPORTS, JSON.stringify(reports));
  } catch {
    // A full or blocked store is not worth failing a game over.
  }
}

/** Send what is queued. Stops at the first network failure and keeps the rest. */
export async function flushEngineStatsReports(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    const cutoff = Date.now() - MAX_AGE_MS;
    let pending = loadPending().filter((report) => report.queuedAt >= cutoff);
    savePending(pending);
    for (const report of pending.slice(0, MAX_PER_FLUSH)) {
      try {
        await recordEngineStats(report.stats);
        pending = pending.filter((item) => item.stats.reportId !== report.stats.reportId);
        savePending(pending);
      } catch (error) {
        // A report the hub refuses will never be accepted, so drop it rather
        // than retrying it forever; anything else is worth another go later.
        if (error instanceof HubRequestError && (error.status === 404 || error.status === 422)) {
          pending = pending.filter((item) => item.stats.reportId !== report.stats.reportId);
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

function queue(stats: EngineGameStats): void {
  const pending = [...loadPending(), { stats, queuedAt: Date.now() }].slice(-MAX_PENDING);
  savePending(pending);
}

/**
 * Close the book on a game. Never throws and never blocks the caller: a game
 * ending must not depend on telemetry working.
 */
export function reportEngineStats(meta: {
  multiplayer: boolean;
  seats: number;
  format: string | null;
  endReason: EngineGameStats["endReason"];
  gameId?: string | null;
  send?: (stats: EngineGameStats, gameId?: string | null) => Promise<void>;
}): void {
  let stats: EngineGameStats | null = null;
  try {
    stats = summariseGame({
      clientVersion: APP_VERSION,
      platform: getPlatform().type,
      format: meta.format,
      seats: meta.seats,
      multiplayer: meta.multiplayer,
      endReason: meta.endReason,
      reportId: crypto.randomUUID(),
      // Carried inside the report as well as beside it, because the hub route
      // has no envelope to put it on. Without it a hub report is an orphan:
      // percentiles with nothing to say what game produced them.
      gameId: meta.gameId ?? null,
    });
  } catch {
    return;
  }
  if (!stats) return;
  if (meta.multiplayer && meta.send) {
    void meta.send(stats, meta.gameId).catch(() => {
      // The relay went away mid-report; the hub can have it instead, and it can
      // have it now — a closed websocket says nothing about the network, and a
      // report left in the queue waits for the next time the app starts.
      queue(stats);
      void flushEngineStatsReports();
    });
    return;
  }
  queue(stats);
  void flushEngineStatsReports();
}
