import type { SpawnAiBotParams } from "@/platform/types";

const KEY = "manabrew.spawnedAiBots";
const VERSION = 1;

interface SpawnedBot extends SpawnAiBotParams {
  deckSelectionPending?: boolean;
}

interface SpawnedBotsRecord {
  version: number;
  roomId: string;
  bots: SpawnedBot[];
}

function readRecord(): SpawnedBotsRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpawnedBotsRecord;
    if (parsed.version !== VERSION) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeRecord(roomId: string, bots: SpawnedBot[]): void {
  localStorage.setItem(KEY, JSON.stringify({ version: VERSION, roomId, bots }));
}

export function rememberSpawnedBot(params: SpawnAiBotParams, deckSelectionPending = false): void {
  try {
    const record = readRecord();
    const bots =
      record?.roomId === params.roomId
        ? [
            ...record.bots.filter((b) => b.username !== params.username),
            { ...params, deckSelectionPending },
          ]
        : [{ ...params, deckSelectionPending }];
    writeRecord(params.roomId, bots);
  } catch {
    // ignore
  }
}

export function forgetSpawnedBot(username: string): void {
  try {
    const record = readRecord();
    if (!record) return;
    const bots = record.bots.filter((b) => b.username !== username);
    if (bots.length === 0) {
      localStorage.removeItem(KEY);
    } else {
      writeRecord(record.roomId, bots);
    }
  } catch {
    // ignore
  }
}

export function clearSpawnedBots(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function peekSpawnedBots(roomId: string): SpawnedBot[] {
  const record = readRecord();
  return record?.roomId === roomId ? record.bots : [];
}
