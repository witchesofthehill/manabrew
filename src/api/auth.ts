import { getHubApiUrl } from "@/config/webRuntimeConfig";
import { platformFetch } from "@/lib/platformFetch";
import type {
  AuthAccount,
  AuthProviders,
  AuthSessionResponse,
  MeResponse,
  OAuthStartResponse,
} from "@/api/authTypes";
import type { AccountExport } from "@/api/hubTypes";

export type OAuthProvider = "github" | "discord";
export type OAuthMode = "signin" | "link";

async function authRequest(path: string, init?: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await platformFetch(`${getHubApiUrl()}${path}`, { ...init, headers });
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many attempts — try again in a few minutes.");
    }
    const message = await response.text().catch(() => "");
    throw new AuthRequestError(response.status, message || `Request failed (${response.status})`);
  }
  return response;
}

export class AuthRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authJson<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await authRequest(path, init, token);
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function fetchAuthProviders(): Promise<AuthProviders> {
  return authJson<AuthProviders>("/api/auth/providers");
}

export async function startOAuth(
  provider: OAuthProvider,
  mode: OAuthMode,
  client: "web" | "desktop",
  token?: string,
): Promise<string> {
  const response = await authJson<OAuthStartResponse>(
    `/api/auth/oauth/${provider}/start`,
    jsonInit("POST", { mode, client }),
    token,
  );
  return response.authorizeUrl;
}

export function exchangeCode(code: string): Promise<AuthSessionResponse> {
  return authJson<AuthSessionResponse>("/api/auth/exchange", jsonInit("POST", { code }));
}

export async function requestMagicLink(email: string): Promise<void> {
  await authRequest("/api/auth/email/request", jsonInit("POST", { email }));
}

export function verifyEmailCode(email: string, code: string): Promise<AuthSessionResponse> {
  return authJson<AuthSessionResponse>("/api/auth/email/verify", jsonInit("POST", { email, code }));
}

export function fetchMe(token: string): Promise<MeResponse> {
  return authJson<MeResponse>("/api/auth/me", undefined, token);
}

export function updateHandle(token: string, handle: string): Promise<AuthAccount> {
  return authJson<AuthAccount>("/api/auth/me", jsonInit("PATCH", { handle }), token);
}

export async function signOutSession(token: string): Promise<void> {
  await authRequest("/api/auth/logout", { method: "POST" }, token);
}

export async function deleteAccount(token: string): Promise<void> {
  await authRequest("/api/auth/me", { method: "DELETE" }, token);
}

export function exportAccount(token: string): Promise<AccountExport> {
  return authJson<AccountExport>("/api/auth/export", undefined, token);
}

export async function unlinkIdentity(token: string, provider: string): Promise<void> {
  await authRequest(
    `/api/auth/identities/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
    token,
  );
}
