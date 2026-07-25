import { toast } from "sonner";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

export function showAccountSaveNudge() {
  if (!isFeatureEnabled("accounts")) return;
  if (useAuthStore.getState().status === "signedIn") return;
  if (usePreferencesStore.getState().hideAccountSaveNudge) return;
  toast("Decks without an account live only in this browser", {
    id: "account-save-nudge",
    description: "Sign in to keep them safe. Playing never requires an account.",
    action: {
      label: "Sign in",
      onClick: () => useSignInDialog.getState().show(),
    },
    cancel: {
      label: "Don't show again",
      onClick: () => usePreferencesStore.getState().setHideAccountSaveNudge(true),
    },
  });
}
