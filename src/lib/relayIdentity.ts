import { requestAccessToken, requestGuestToken } from "@/api/auth";
import { isFeatureEnabled } from "@/featureFlags";
import {
  GUEST_SUBJECT_PREFIX,
  HUB_ISSUER,
  mintUnsignedIdentityToken,
  tokenClaims,
  tokenHandle,
} from "@/lib/identityToken";
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

export interface RelayIdentity {
  proof: RelayIdentityProof;
  username: string;
}

export class IdentityMintError extends Error {
  constructor() {
    super("account token mint failed; refusing to reconnect with a downgraded identity");
  }
}

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

async function identityToken(): Promise<string | undefined> {
  if (!isFeatureEnabled("accounts")) return undefined;
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return undefined;
  try {
    const minted = await Promise.race([
      requestAccessToken(refreshToken, RELAY_AUDIENCE),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FETCH_TIMEOUT_MS)),
    ]);
    return minted?.access_token;
  } catch {
    return undefined;
  }
}

async function guestToken(name: string): Promise<string | undefined> {
  if (!isFeatureEnabled("accounts")) return undefined;
  const device = deviceSecret();
  if (!device) return undefined;
  try {
    const minted = await Promise.race([
      requestGuestToken(name, device),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_FETCH_TIMEOUT_MS)),
    ]);
    return minted?.access_token;
  } catch {
    return undefined;
  }
}

function tokenClass(token: string): "account" | "guest" | "unsigned" {
  const claims = tokenClaims(token);
  if (!claims || claims.iss !== HUB_ISSUER) return "unsigned";
  return claims.sub.startsWith(GUEST_SUBJECT_PREFIX) ? "guest" : "account";
}

function tokenCurrent(token: string): boolean {
  const claims = tokenClaims(token);
  return claims != null && claims.exp * 1000 - TOKEN_EXPIRY_MARGIN_MS > Date.now();
}

async function freshIdentity(requestedName: string): Promise<RelayIdentity> {
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

async function renewedIdentity(previous: RelayIdentity, token: string): Promise<RelayIdentity> {
  const handle = tokenHandle(token) ?? previous.username;
  switch (tokenClass(token)) {
    case "account": {
      const minted = await identityToken();
      if (!minted) throw new IdentityMintError();
      return {
        proof: { token: minted, device: previous.proof.device },
        username: tokenHandle(minted) ?? handle,
      };
    }
    case "guest": {
      const minted = (await guestToken(handle)) ?? mintUnsignedIdentityToken("self", handle);
      return {
        proof: { token: minted, device: previous.proof.device },
        username: tokenHandle(minted) ?? handle,
      };
    }
    case "unsigned":
      return {
        proof: { token: mintUnsignedIdentityToken("self", handle), device: previous.proof.device },
        username: handle,
      };
  }
}

export async function resolveRelayIdentity(
  previous: RelayIdentity | null,
  requestedName: string,
  forceRemint = false,
): Promise<RelayIdentity> {
  const token = previous?.proof.token;
  if (!previous || !token) return freshIdentity(requestedName);
  if (!forceRemint && tokenCurrent(token)) return previous;
  return renewedIdentity(previous, token);
}
