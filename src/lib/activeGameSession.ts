const KEY = "manabrew.activeMultiplayerGame";

export interface ActiveGameSession {
  roomId: string;
  gameId: string;
  isHost: boolean;
  username: string;
  ownsForgeHost?: boolean;
  relayHost?: string;
  relayPort?: number;
  relayPassword?: string;
}

export function armActiveGameSession(session: ActiveGameSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function peekActiveGameSession(): ActiveGameSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveGameSession;
  } catch {
    return null;
  }
}

export function clearActiveGameSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

const sessionAtPageLoad = peekActiveGameSession();
let abandonmentPending = false;

export function activeGameSessionAtPageLoad(): ActiveGameSession | null {
  return sessionAtPageLoad;
}

export function isActiveGameSessionAtPageLoadCurrent(): boolean {
  const current = peekActiveGameSession();
  return (
    sessionAtPageLoad !== null &&
    current?.roomId === sessionAtPageLoad.roomId &&
    current.gameId === sessionAtPageLoad.gameId
  );
}

export function beginActiveGameSessionAbandonment(): void {
  abandonmentPending = true;
}

export function endActiveGameSessionAbandonment(): void {
  abandonmentPending = false;
}

export function isActiveGameSessionAbandonmentPending(): boolean {
  return abandonmentPending;
}
