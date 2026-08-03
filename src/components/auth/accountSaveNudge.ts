import { toast } from "sonner";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

export function showAccountSaveNudge() {
  if (!isFeatureEnabled("accounts")) return;
  if (useAuthStore.getState().status === "signedIn") return;
  if (usePreferencesStore.getState().hideAccountSaveNudge) return;
  toast("Saved in this browser only", {
    id: "account-save-nudge",
    duration: 15_000,
    description: isFeatureEnabled("deckHub")
      ? "Sign in to save decks across devices or publish them. Playing stays account-free."
      : "Sign in to save decks across devices. Playing stays account-free.",
    action: {
      label: "Sign in",
      onClick: () => useSignInDialog.getState().show(),
    },
    cancel: {
      label: "Don’t show again",
      onClick: () => usePreferencesStore.getState().setHideAccountSaveNudge(true),
    },
  });
}
