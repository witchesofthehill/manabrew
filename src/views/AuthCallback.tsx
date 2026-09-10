import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { exchangeCode } from "@/api/auth";
import { ROUTES } from "@/lib/constants";
import { useAuthStore } from "@/stores/useAuthStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { takeAuthReturnIntent } from "@/lib/authReturn";
import { isFeatureEnabled } from "@/featureFlags";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const ERROR_MESSAGES: Record<string, string> = {
  get state_expired() {
    return i18n._(msg`The sign-in attempt expired. Try again.`);
  },
  get oauth_denied() {
    return i18n._(msg`Sign-in was cancelled.`);
  },
  get oauth_failed() {
    return i18n._(msg`Sign-in failed. Try again.`);
  },
  get identity_taken() {
    return i18n._(msg`That account is already linked to a different Manabrew account.`);
  },
  get link_expired() {
    return i18n._(msg`The sign-in link expired. Request a new code.`);
  },
};
const PROVIDER_LABELS: Record<string, string> = {
  get github() {
    return i18n._(msg`GitHub`);
  },
  get discord() {
    return i18n._(msg`Discord`);
  },
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
      toast.success(i18n._(msg`${PROVIDER_LABELS[linked] ?? linked} linked to your account`));
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
            toast.success(i18n._(msg`Signed in as @${session.account.handle}`));
          }
          navigate(returnIntent.returnTo, { replace: true, state: returnState });
        })
        .catch(() => {
          toast.error(i18n._(msg`Sign-in failed. Try again.`));
          navigate(returnIntent.returnTo, { replace: true });
        });
      return;
    }
    navigate(returnIntent.returnTo, { replace: true });
  }, [navigate]);
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        <Trans>Completing sign-in…</Trans>
      </p>
    </div>
  );
}
