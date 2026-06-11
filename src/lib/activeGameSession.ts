const KEY = "manabrew.activeMultiplayerGame";

export interface ActiveGameSession {
  roomId: string;
  isHost: boolean;
  username: string;
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

export function activeGameSessionAtPageLoad(): ActiveGameSession | null {
  return sessionAtPageLoad;
}
