import { fetchIdentityToken } from "@/api/auth";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";

const DEVICE_SECRET_STORAGE_KEY = "manabrew.deviceSecret";
const DEVICE_SECRET_BYTES = 24;
const TOKEN_EXPIRY_MARGIN_MS = 30_000;
// A slow or down hub must never hold up connecting to the relay: the device
// secret alone still identifies the session.
const TOKEN_FETCH_TIMEOUT_MS = 2_000;

export interface RelayIdentityProof {
  token?: string;
  device?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function encodeSecret(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function deviceSecret(): string | undefined {
  try {
    const stored = window.localStorage.getItem(DEVICE_SECRET_STORAGE_KEY);
    if (stored) return stored;
    const secret = encodeSecret(crypto.getRandomValues(new Uint8Array(DEVICE_SECRET_BYTES)));
    window.localStorage.setItem(DEVICE_SECRET_STORAGE_KEY, secret);
    return secret;
  } catch {
    return undefined;
  }
}

export function clearIdentityToken(): void {
  cachedToken = null;
}

async function identityToken(): Promise<string | undefined> {
  if (!isFeatureEnabled("accounts")) return undefined;
  const session = useAuthStore.getState().token;
  if (!session) return undefined;
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }
  try {
    const minted = await Promise.race([
      fetchIdentityToken(session),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FETCH_TIMEOUT_MS)),
    ]);
    if (!minted) return undefined;
    cachedToken = {
      value: minted.token,
      expiresAt: Date.now() + minted.expiresIn * 1000,
    };
    return minted.token;
  } catch {
    return undefined;
  }
}

export async function relayIdentityProof(): Promise<RelayIdentityProof | undefined> {
  const [token, device] = [await identityToken(), deviceSecret()];
  if (!token && !device) return undefined;
  return { token, device };
}
