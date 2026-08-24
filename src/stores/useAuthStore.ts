import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { fetchMe, requestAccessToken, signOutSession, AuthRequestError } from "@/api/auth";
import { clearIdentityToken } from "@/lib/relayIdentity";
import { isFeatureEnabled } from "@/featureFlags";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { AuthAccount, AuthIdentity, AuthSessionResponse } from "@/api/authTypes";

export type AuthStatus = "unknown" | "signedOut" | "signedIn";

const ACCESS_TOKEN_EXPIRY_MARGIN_MS = 30_000;

let refreshRequestId = 0;
let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let pendingAccessToken: Promise<string | null> | null = null;

function holdAccessToken(token: string, expiresIn: number) {
  accessToken = token;
  accessTokenExpiresAt = Date.now() + expiresIn * 1000;
}

function dropAccessToken() {
  accessToken = null;
  accessTokenExpiresAt = 0;
  pendingAccessToken = null;
}

async function mintAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const minted = await requestAccessToken(refreshToken);
    holdAccessToken(minted.access_token, minted.expires_in);
    return minted.access_token;
  } catch (err) {
    if (err instanceof AuthRequestError && err.status === 400) {
      await useAuthStore.getState().signOut();
    }
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!isFeatureEnabled("accounts")) return null;
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  if (accessToken && Date.now() < accessTokenExpiresAt - ACCESS_TOKEN_EXPIRY_MARGIN_MS) {
    return accessToken;
  }
  pendingAccessToken ??= mintAccessToken(refreshToken).finally(() => {
    pendingAccessToken = null;
  });
  return pendingAccessToken;
}

interface AuthState {
  refreshToken: string | null;
  account: AuthAccount | null;
  identities: AuthIdentity[];
  status: AuthStatus;
  signIn: (session: AuthSessionResponse) => void;
  setAccount: (account: AuthAccount) => void;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

function adoptAccountAvatar(account: AuthAccount): void {
  if (!account.avatarUrl) return;
  const prefs = usePreferencesStore.getState();
  if (prefs.customAvatarAssetId === account.avatarAssetId) return;
  prefs.setCustomAvatar(account.avatarUrl, account.avatarAssetId);
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set, get) => ({
        refreshToken: null,
        account: null,
        identities: [],
        status: "unknown",
        signIn: (session) => {
          refreshRequestId += 1;
          clearIdentityToken();
          dropAccessToken();
          holdAccessToken(session.access_token, session.expires_in);
          set({
            refreshToken: session.refresh_token,
            account: session.account,
            identities: [],
            status: "signedIn",
          });
          void get().refresh();
        },
        setAccount: (account) => {
          refreshRequestId += 1;
          clearIdentityToken();
          set({ account });
          void get().refresh();
        },
        hydrate: async () => {
          if (!get().refreshToken || !isFeatureEnabled("accounts")) {
            set({ status: "signedOut" });
            return;
          }
          await get().refresh();
        },
        refresh: async () => {
          const refreshToken = get().refreshToken;
          if (!refreshToken) return;
          const requestId = ++refreshRequestId;
          const token = await getAccessToken();
          if (!token) return;
          try {
            const me = await fetchMe(token);
            if (get().refreshToken !== refreshToken || requestId !== refreshRequestId) return;
            set({ account: me.account, identities: me.identities, status: "signedIn" });
            adoptAccountAvatar(me.account);
          } catch (err) {
            if (
              get().refreshToken === refreshToken &&
              requestId === refreshRequestId &&
              err instanceof AuthRequestError &&
              err.status === 401
            ) {
              dropAccessToken();
              set({ refreshToken: null, account: null, identities: [], status: "signedOut" });
            }
          }
        },
        signOut: async () => {
          const refreshToken = get().refreshToken;
          refreshRequestId += 1;
          clearIdentityToken();
          dropAccessToken();
          set({ refreshToken: null, account: null, identities: [], status: "signedOut" });
          if (refreshToken) {
            await signOutSession(refreshToken).catch(() => {});
          }
        },
      }),
      {
        name: "manabrew-auth-storage",
        version: 2,
        // The refresh token persists in localStorage on purpose: staying signed
        // in across reloads is the product behavior, and any XSS that could
        // read it could call the API directly anyway. It is presented only to
        // the token endpoint, sign-out revokes it, and the hub stores only its
        // sha256. Access tokens stay in memory and last ten minutes.
        partialize: (state) => ({
          refreshToken: state.refreshToken,
          account: state.account,
        }),
        migrate: (persisted, version) => {
          if (version === 0 && persisted && typeof persisted === "object") {
            const legacy = (persisted as { token?: string | null }).token ?? null;
            return { refreshToken: legacy, account: null };
          }
          if (version === 1 && persisted && typeof persisted === "object") {
            const { refreshToken } = persisted as { refreshToken: string | null };
            return { refreshToken, account: null };
          }
          return persisted as { refreshToken: string | null; account: AuthAccount | null };
        },
        onRehydrateStorage: () => (state) => {
          if (state?.refreshToken && isFeatureEnabled("accounts")) {
            useAuthStore.setState({ status: "signedIn" });
          }
        },
      },
    ),
    { name: "auth", enabled: import.meta.env.DEV },
  ),
);
