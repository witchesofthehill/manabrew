import { requestAccessToken, requestGuestToken } from "@/api/auth";
import { isFeatureEnabled } from "@/featureFlags";
import { mintUnsignedIdentityToken, tokenHandle } from "@/lib/identityToken";
import { useAuthStore } from "@/stores/useAuthStore";

const RELAY_AUDIENCE = "manabrew-relay";
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
let cachedGuestToken: { name: string; value: string; expiresAt: number } | null = null;

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
  cachedGuestToken = null;
}

async function identityToken(): Promise<string | undefined> {
  if (!isFeatureEnabled("accounts")) return undefined;
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return undefined;
  if (cachedToken && cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()) {
    return cachedToken.value;
  }
  try {
    const minted = await Promise.race([
      requestAccessToken(refreshToken, RELAY_AUDIENCE),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FETCH_TIMEOUT_MS)),
    ]);
    if (!minted) return undefined;
    cachedToken = {
      value: minted.access_token,
      expiresAt: Date.now() + minted.expires_in * 1000,
    };
    return minted.access_token;
  } catch {
    return undefined;
  }
}

async function guestToken(name: string): Promise<string | undefined> {
  if (!isFeatureEnabled("accounts")) return undefined;
  const device = deviceSecret();
  if (!device) return undefined;
  if (
    cachedGuestToken &&
    cachedGuestToken.name === name &&
    cachedGuestToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS > Date.now()
  ) {
    return cachedGuestToken.value;
  }
  try {
    const minted = await Promise.race([
      requestGuestToken(name, device),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FETCH_TIMEOUT_MS)),
    ]);
    if (!minted) return undefined;
    cachedGuestToken = {
      name,
      value: minted.access_token,
      expiresAt: Date.now() + minted.expires_in * 1000,
    };
    return minted.access_token;
  } catch {
    return undefined;
  }
}

export interface RelayIdentity {
  proof: RelayIdentityProof;
  username: string;
}

export async function relayIdentity(requestedName: string): Promise<RelayIdentity> {
  const account = await identityToken();
  const signedIn = useAuthStore.getState().status === "signedIn";
  const token =
    account ??
    (!signedIn ? await guestToken(requestedName) : undefined) ??
    mintUnsignedIdentityToken("self", requestedName);
  return {
    proof: { token, device: deviceSecret() },
    username: tokenHandle(token) ?? requestedName,
  };
}
