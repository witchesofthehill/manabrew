import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignInFlow } from "@/components/auth/SignInFlow";
import { OnboardingHurray } from "@/components/OnboardingHurray";
import { isFeatureEnabled } from "@/featureFlags";
import { isNameClaimedError, reserveGuestName } from "@/lib/guestName";
import { useAuthStore } from "@/stores/useAuthStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

type Step = "nickname" | "signin" | "hurray";

export const ONBOARDING_GUIDE_VERSION = "1.0";
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 24;
export function OnboardingWelcome({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<Step>(() =>
    useAuthStore.getState().account?.handlePending ? "hurray" : "nickname",
  );
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step === "hurray") useSignInDialog.getState().hide();
  }, [step]);
  const trimmed = nickname.trim();
  const canConfirm = trimmed.length >= NICKNAME_MIN_LENGTH && !busy;
  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      await reserveGuestName(trimmed);
      onComplete();
    } catch (err) {
      setError(
        isNameClaimedError(err)
          ? "That name is already claimed. Pick another."
          : err instanceof Error
            ? err.message
            : "Could not set your name.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (step === "hurray") {
    return <OnboardingHurray onComplete={onComplete} />;
  }

  if (step === "signin" && isFeatureEnabled("accounts")) {
    return (
      <div className="w-full space-y-4">
        <SignInFlow
          deferHandleStep
          onComplete={() =>
            useAuthStore.getState().account?.handlePending ? setStep("hurray") : onComplete()
          }
        />
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setStep("nickname")}>
          Use a nickname instead
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2">
        <label
          htmlFor="onboarding-nickname"
          className="block text-center text-sm font-semibold text-foreground"
        >
          Choose your nickname
        </label>
        <p className="text-center text-xs text-muted-foreground">
          Other players will see this name when you connect to a server.
        </p>
        <Input
          id="onboarding-nickname"
          autoFocus
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder={`e.g. StormCrow`}
          onChange={(event) => {
            setNickname(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void confirm();
          }}
          className="mx-auto max-w-xs bg-card/60 text-center"
        />
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button
          variant="primary"
          disabled={!canConfirm}
          onClick={() => void confirm()}
          className="w-full max-w-xs"
        >
          {busy ? "Checking…" : "Let's brew"}
        </Button>
        {isFeatureEnabled("accounts") && (
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setStep("signin")}
            >
              Sign in
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
