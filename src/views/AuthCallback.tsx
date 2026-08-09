import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { exchangeCode } from "@/api/auth";
import { ROUTES } from "@/lib/constants";
import { useAuthStore } from "@/stores/useAuthStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { takeAuthReturnIntent } from "@/lib/authReturn";
import { isFeatureEnabled } from "@/featureFlags";

const ERROR_MESSAGES: Record<string, string> = {
  state_expired: "The sign-in attempt expired. Try again.",
  oauth_denied: "Sign-in was cancelled.",
  oauth_failed: "Sign-in failed. Try again.",
  identity_taken: "That account is already linked to a different Manabrew account.",
  link_expired: "The sign-in link expired. Request a new code.",
};

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  discord: "Discord",
};

export default function AuthCallback() {
  const navigate = useNavigate();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(null, "", "/auth/callback");
    const error = params.get("error");
    const linked = params.get("linked");
    const code = params.get("code");
    const email = params.get("email");
    const returnIntent = takeAuthReturnIntent();
    const publishEnabled = isFeatureEnabled("accounts") && isFeatureEnabled("deckHub");
    const returnState =
      publishEnabled && (returnIntent.publishDeck || returnIntent.resumeCurrentPublish)
        ? {
            resumePublishDeckId: returnIntent.publishDeckId,
            resumePublishDeck: returnIntent.publishDeck,
            resumeCurrentPublish: returnIntent.resumeCurrentPublish,
          }
        : undefined;

    if (error) {
      toast.error(ERROR_MESSAGES[error] ?? "Sign-in failed. Try again.");
      navigate(returnIntent.returnTo, { replace: true });
      return;
    }
    if (linked) {
      toast.success(`${PROVIDER_LABELS[linked] ?? linked} linked to your account`);
      void useAuthStore.getState().refresh();
      navigate(ROUTES.SETTINGS, { replace: true, state: { settingsTab: "account" } });
      return;
    }
    if (email && code) {
      useSignInDialog.getState().show({
        email,
        code,
        returnTo: returnIntent.returnTo,
        publishDeckId: publishEnabled ? returnIntent.publishDeckId : undefined,
        publishDeck: publishEnabled ? returnIntent.publishDeck : undefined,
        resumeCurrentPublish: publishEnabled ? returnIntent.resumeCurrentPublish : undefined,
      });
      navigate(returnIntent.returnTo, { replace: true, state: returnState });
      return;
    }
    if (code) {
      exchangeCode(code)
        .then((session) => {
          useAuthStore.getState().signIn(session);
          if (session.account.handlePending) {
            useSignInDialog.getState().show({ claimHandle: true });
          } else {
            toast.success(`Signed in as @${session.account.handle}`);
          }
          navigate(returnIntent.returnTo, { replace: true, state: returnState });
        })
        .catch(() => {
          toast.error("Sign-in failed. Try again.");
          navigate(returnIntent.returnTo, { replace: true });
        });
      return;
    }
    navigate(returnIntent.returnTo, { replace: true });
  }, [navigate]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  );
}
