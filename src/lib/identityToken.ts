// The relay identity token defined in manabrew-relay-protocol/src/identity_token.rs:
// the `handle` claim is the session's one and only name. The hub mints signed
// tokens; when it is unreachable the client mints the same shape unsigned and
// the relay treats the name as unverified.

const SELF_ISSUER = "manabrew-client";
const RELAY_AUDIENCE = "manabrew-relay";
const UNSIGNED_TTL_S = 24 * 60 * 60;

export const HUB_ISSUER = "manabrew-hub";
export const GUEST_SUBJECT_PREFIX = "guest:";

function base64UrlEncode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
  try {
    return decodeURIComponent(escape(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return null;
  }
}

export function mintUnsignedIdentityToken(subject: string, handle: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "none" }));
  const claims = base64UrlEncode(
    JSON.stringify({
      sub: subject,
      handle,
      iss: SELF_ISSUER,
      aud: RELAY_AUDIENCE,
      iat,
      exp: iat + UNSIGNED_TTL_S,
    }),
  );
  return `${header}.${claims}.`;
}

export function tokenHandle(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const claims = base64UrlDecode(parts[1]);
  if (!claims) return null;
  try {
    const parsed = JSON.parse(claims) as { handle?: unknown };
    return typeof parsed.handle === "string" && parsed.handle.trim() ? parsed.handle : null;
  } catch {
    return null;
  }
}

export interface RelayTokenClaims {
  sub: string;
  iss: string;
  exp: number;
}

export function tokenClaims(token: string): RelayTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const claims = base64UrlDecode(parts[1]);
  if (!claims) return null;
  try {
    const parsed = JSON.parse(claims) as Record<string, unknown>;
    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.iss !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return { sub: parsed.sub, iss: parsed.iss, exp: parsed.exp };
  } catch {
    return null;
  }
}
