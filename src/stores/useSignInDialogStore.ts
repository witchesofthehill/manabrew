import { create } from "zustand";
import type { AuthReturnIntent } from "@/lib/authReturn";

export interface SignInPrefill extends Partial<AuthReturnIntent> {
  email?: string;
  code?: string;
  claimHandle?: boolean;
}

interface SignInDialogState {
  open: boolean;
  prefill: SignInPrefill | null;
  show: (prefill?: SignInPrefill) => void;
  hide: () => void;
}

export const useSignInDialog = create<SignInDialogState>()((set) => ({
  open: false,
  prefill: null,
  show: (prefill) => set({ open: true, prefill: prefill ?? null }),
  hide: () => set({ open: false, prefill: null }),
}));
