import { toast } from "sonner";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

export function showAccountSaveNudge() {
  if (!isFeatureEnabled("accounts") || !isFeatureEnabled("deckHub")) return;
  if (useAuthStore.getState().status === "signedIn") return;
  if (usePreferencesStore.getState().hideAccountSaveNudge) return;
  toast("Saved in this browser only", {
    id: "account-save-nudge",
    duration: 15_000,
    description: "Sign in to publish a cross-device snapshot. Playing never requires an account.",
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
