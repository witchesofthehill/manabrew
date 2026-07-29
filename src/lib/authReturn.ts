import type { EditorDeck } from "@/types/manabrew";

const AUTH_RETURN_STORAGE_KEY = "manabrew.authReturn";
const AUTH_RETURN_MAX_AGE_MS = 15 * 60 * 1000;

export interface AuthReturnIntent {
  returnTo: string;
  publishDeckId?: string;
  publishDeck?: EditorDeck;
  resumeCurrentPublish?: boolean;
}

interface StoredAuthReturnIntent extends AuthReturnIntent {
  createdAt: number;
}

function safeReturnTo(value?: string): string {
  if (!value) return "/play";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/auth/callback") return "/play";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/play";
  }
}

function parseStoredIntent(raw: string): Partial<StoredAuthReturnIntent> | null {
  try {
    const intent = JSON.parse(raw) as Partial<StoredAuthReturnIntent>;
    if (
      typeof intent.createdAt !== "number" ||
      Date.now() - intent.createdAt > AUTH_RETURN_MAX_AGE_MS
    ) {
      return null;
    }
    return intent;
  } catch {
    return null;
  }
}

export function storeAuthReturnIntent(intent: Partial<AuthReturnIntent> = {}): void {
  const returnTo = safeReturnTo(
    intent.returnTo ??
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  window.localStorage.setItem(
    AUTH_RETURN_STORAGE_KEY,
    JSON.stringify({ ...intent, returnTo, createdAt: Date.now() }),
  );
}

export function clearAuthReturnIntent(): void {
  window.localStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
}

export function hasPendingEditorPublication(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(AUTH_RETURN_STORAGE_KEY);
  if (!raw) return false;
  return parseStoredIntent(raw)?.resumeCurrentPublish === true;
}

export function takeAuthReturnIntent(): AuthReturnIntent {
  const raw = window.localStorage.getItem(AUTH_RETURN_STORAGE_KEY);
  clearAuthReturnIntent();
  if (!raw) return { returnTo: "/play" };
  const intent = parseStoredIntent(raw);
  if (!intent) return { returnTo: "/play" };
  return {
    returnTo: safeReturnTo(intent.returnTo),
    publishDeckId: typeof intent.publishDeckId === "string" ? intent.publishDeckId : undefined,
    publishDeck:
      intent.publishDeck && typeof intent.publishDeck === "object" ? intent.publishDeck : undefined,
    resumeCurrentPublish: intent.resumeCurrentPublish === true,
  };
}
