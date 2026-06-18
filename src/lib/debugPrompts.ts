const KEY = "manabrew.debugPrompts";

export function isPromptLoggingEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPromptLoggingEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // ignore (private-mode / SSR)
  }
}
