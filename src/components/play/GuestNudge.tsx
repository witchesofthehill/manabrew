import { UserRound, X } from "lucide-react";
import { useState } from "react";
import { GuestNamePicker } from "@/components/settings/GuestNamePicker";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/featureFlags";
import { useAcknowledgement } from "@/hooks/useAcknowledgement";
import { stripUsernameTag } from "@/lib/username";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

const NUDGE_STORAGE_KEY = "manabrew.signupNudge";
const NUDGE_VERSION = "1";

/**
 * First-run players start under a generated guest name. This card tells them
 * the name and offers a rename or an account, without blocking play.
 */
export function GuestNudge() {
  const signedOut = useAuthStore((s) => s.status !== "signedIn");
  const serverUsername = usePreferencesStore((s) => s.serverUsername);
  const showSignIn = useSignInDialog((s) => s.show);
  const { accepted: dismissed, accept: dismiss } = useAcknowledgement(
    NUDGE_STORAGE_KEY,
    NUDGE_VERSION,
  );
  const [renaming, setRenaming] = useState(false);
  if (!signedOut || dismissed) return null;
  const accounts = isFeatureEnabled("accounts");
  return (
    <section
      aria-label={`Guest profile`}
      className="rounded-lg border border-border/60 bg-background/60 p-3 backdrop-blur-md sm:p-4"
    >
      <div className="flex items-start gap-3">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm">
            You are playing as{" "}
            <span className="font-semibold">{stripUsernameTag(serverUsername)}</span>.
          </p>
          <p className="text-xs text-muted-foreground">
            {accounts
              ? `Create a free account to claim your name and keep your decks on every device.`
              : `Other players see this name at the table.`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
          onClick={dismiss}
          aria-label={`Dismiss`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {renaming ? (
        <div className="mt-3 max-w-md sm:pl-7">
          <GuestNamePicker />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2 sm:pl-7">
          {accounts && (
            <Button variant="primary" size="sm" onClick={() => showSignIn()}>
              Create account
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
            Change name
          </Button>
        </div>
      )}
    </section>
  );
}
