import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { fetchMe, signOutSession, AuthRequestError } from "@/api/auth";
import { isFeatureEnabled } from "@/featureFlags";
import type { AuthAccount, AuthIdentity } from "@/api/authTypes";

export type AuthStatus = "unknown" | "signedOut" | "signedIn";

let refreshRequestId = 0;

interface AuthState {
  token: string | null;
  account: AuthAccount | null;
  identities: AuthIdentity[];
  status: AuthStatus;
  signIn: (token: string, account: AuthAccount) => void;
  setAccount: (account: AuthAccount) => void;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set, get) => ({
        token: null,
        account: null,
        identities: [],
        status: "unknown",
        signIn: (token, account) => {
          refreshRequestId += 1;
          set({ token, account, identities: [], status: "signedIn" });
          void get().refresh();
        },
        setAccount: (account) => {
          refreshRequestId += 1;
          set({ account });
          void get().refresh();
        },
        hydrate: async () => {
          const token = get().token;
          if (!token || !isFeatureEnabled("accounts")) {
            set({ status: "signedOut" });
            return;
          }
          await get().refresh();
        },
        refresh: async () => {
          const token = get().token;
          if (!token) return;
          const requestId = ++refreshRequestId;
          try {
            const me = await fetchMe(token);
            if (get().token !== token || requestId !== refreshRequestId) return;
            set({ account: me.account, identities: me.identities, status: "signedIn" });
          } catch (err) {
            if (
              get().token === token &&
              requestId === refreshRequestId &&
              err instanceof AuthRequestError &&
              err.status === 401
            ) {
              set({ token: null, account: null, identities: [], status: "signedOut" });
            }
          }
        },
        signOut: async () => {
          const token = get().token;
          refreshRequestId += 1;
          set({ token: null, account: null, identities: [], status: "signedOut" });
          if (token) {
            await signOutSession(token).catch(() => {});
          }
        },
      }),
      {
        name: "manabrew-auth-storage",
        // The bearer token persists in localStorage on purpose: staying signed
        // in across reloads is the product behavior, and any XSS that could
        // read it could call the API directly anyway. Sign-out revokes the
        // session server-side, and the hub stores only its sha256.
        partialize: (state) => ({
          token: state.token,
        }),
      },
    ),
    { name: "auth", enabled: import.meta.env.DEV },
  ),
);
