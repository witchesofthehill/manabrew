import { useState } from "react";
import { toast } from "sonner";
import { PartyPopper, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthRequestError, updateHandle } from "@/api/auth";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";

const HANDLE_MIN_LENGTH = 3;
const HANDLE_MAX_LENGTH = 24;

export function OnboardingHurray({ onComplete }: { onComplete: () => void }) {
  const setAccount = useAuthStore((s) => s.setAccount);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = handle.trim();

  const start = async () => {
    if (trimmed.length < HANDLE_MIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const updated = await updateHandle(token, trimmed);
      setAccount(updated);
      toast.success(`Welcome, @${updated.handle}!`);
      onComplete();
    } catch (err) {
      setError(
        err instanceof AuthRequestError && err.status === 409
          ? "That username is already taken."
          : err instanceof Error
            ? err.message
            : "Could not set your username.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-onboard-fade-up flex w-full flex-col items-center gap-6">
      <div className="relative">
        <span className="flex size-20 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/25">
          <PartyPopper className="size-9 animate-hurray-pop motion-reduce:animate-none" />
        </span>
        <Sparkles className="absolute -left-4 -top-1 size-4 animate-hurray-sparkle text-primary motion-reduce:animate-none" />
        <Sparkles className="absolute -right-3 bottom-0 size-3 animate-hurray-sparkle text-primary [animation-delay:400ms] motion-reduce:animate-none" />
      </div>

      <div className="space-y-1 text-center">
        <h3 className="text-lg font-semibold text-foreground">Hurray, you're in!</h3>
        <p className="text-sm text-muted-foreground">
          Claim your username, others won't be able to steal it!
        </p>
      </div>

      <div className="w-full space-y-2">
        <Input
          autoFocus
          value={handle}
          maxLength={HANDLE_MAX_LENGTH}
          placeholder="your-username"
          onChange={(event) => {
            setHandle(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy && trimmed.length >= HANDLE_MIN_LENGTH) {
              void start();
            }
          }}
          className="mx-auto max-w-xs bg-card/60 text-center"
        />
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>

      <Button
        disabled={busy || trimmed.length < HANDLE_MIN_LENGTH}
        onClick={() => void start()}
        className="w-full max-w-xs"
      >
        {busy
          ? "Saving…"
          : trimmed.length >= HANDLE_MIN_LENGTH
            ? `Start as @${trimmed}`
            : "Claim your username"}
      </Button>
    </div>
  );
}
