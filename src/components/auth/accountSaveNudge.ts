import { toast } from "sonner";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function showAccountSaveNudge() {
  if (!isFeatureEnabled("accounts")) return;
  if (useAuthStore.getState().status === "signedIn") return;
  if (usePreferencesStore.getState().hideAccountSaveNudge) return;
  toast("Saved in this browser only", {
    id: "account-save-nudge",
    duration: 15000,
    description: isFeatureEnabled("deckHub")
      ? "Sign in to save decks across devices or publish them. Playing stays account-free."
      : "Sign in to save decks across devices. Playing stays account-free.",
    action: {
      get label() {
        return i18n._(msg`Sign in`);
      },
      onClick: () => useSignInDialog.getState().show(),
    },
    cancel: {
      get label() {
        return i18n._(msg`Don\u2019t show again`);
      },
      onClick: () => usePreferencesStore.getState().setHideAccountSaveNudge(true),
    },
  });
}
