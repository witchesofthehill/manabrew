import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AboutContent } from "@/components/AboutContent";
import { isNameClaimedError, reserveGuestName } from "@/lib/guestName";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export const ONBOARDING_GUIDE_VERSION = "1.0";
const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 24;
export function OnboardingWelcome({ onComplete }: { onComplete: () => void }) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return (
    <div className="w-full space-y-6">
      <div className="space-y-1 text-center">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.45em] text-muted-foreground/80">
          <Trans>Getting started</Trans>
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans>A quick tour before you brew your first game.</Trans>
        </p>
      </div>

      <AboutContent />

      <div className="space-y-2">
        <label
          htmlFor="onboarding-nickname"
          className="block text-center text-sm font-semibold text-foreground"
        >
          <Trans>Choose your nickname</Trans>
        </label>
        <p className="text-center text-xs text-muted-foreground">
          <Trans>Other players will see this name when you connect to a server.</Trans>
        </p>
        <Input
          id="onboarding-nickname"
          autoFocus
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder={i18n._(msg`e.g. StormCrow`)}
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

      <div className="flex justify-center">
        <Button disabled={!canConfirm} onClick={() => void confirm()} className="min-w-[200px]">
          {busy ? i18n._(msg`Checking\u2026`) : i18n._(msg`Let's brew`)}
        </Button>
      </div>
    </div>
  );
}
