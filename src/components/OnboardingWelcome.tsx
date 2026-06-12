import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AboutContent } from "@/components/AboutContent";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export const ONBOARDING_GUIDE_VERSION = "1.0";

const NICKNAME_MIN_LENGTH = 2;
const NICKNAME_MAX_LENGTH = 24;

export function OnboardingWelcome({ onComplete }: { onComplete: () => void }) {
  const setServerUsername = usePreferencesStore((s) => s.setServerUsername);
  const [nickname, setNickname] = useState("");
  const trimmed = nickname.trim();
  const canConfirm = trimmed.length >= NICKNAME_MIN_LENGTH;

  const confirm = () => {
    if (!canConfirm) return;
    setServerUsername(trimmed);
    onComplete();
  };

  return (
    <div className="w-full space-y-6">
      <div className="space-y-1 text-center">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.45em] text-muted-foreground/80">
          Getting started
        </p>
        <p className="text-sm text-muted-foreground">
          A quick tour before you brew your first game.
        </p>
      </div>

      <AboutContent fullBleedCarousel />

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
          placeholder="e.g. StormCrow"
          onChange={(event) => setNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") confirm();
          }}
          className="mx-auto max-w-xs bg-card/60 text-center"
        />
      </div>

      <div className="flex justify-center">
        <Button disabled={!canConfirm} onClick={confirm} className="min-w-[200px]">
          Let's brew
        </Button>
      </div>
    </div>
  );
}
