import { useEffect, useState } from "react";
import { GiEvilEyes } from "react-icons/gi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { requestGuestToken } from "@/api/auth";
import { isNameClaimedError, reserveGuestName } from "@/lib/guestName";
import { deviceSecret } from "@/lib/relayIdentity";
import { stripUsernameTag } from "@/lib/username";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useSignInDialog } from "@/stores/useSignInDialogStore";

const NAME_MIN_LENGTH = 2;

// A guest's name is not reserved, so an account can claim it while the guest is
// away. On return, the Hub refuses to vouch the stale name; this forces a
// rename before the guest can do anything, since the relay won't accept them
// under a claimed handle.
export function GuestNameConflictModal() {
  const status = useAuthStore((s) => s.status);
  const serverUsername = usePreferencesStore((s) => s.serverUsername);
  const showSignIn = useSignInDialog((s) => s.show);
  const [conflict, setConflict] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "signedOut" || !serverUsername) {
      setConflict(false);
      return;
    }
    const device = deviceSecret();
    if (!device) return;
    let cancelled = false;
    void requestGuestToken(serverUsername, device)
      .then(() => {
        if (!cancelled) setConflict(false);
      })
      .catch((err) => {
        if (!cancelled && isNameClaimedError(err)) setConflict(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, serverUsername]);

  const base = name.trim();

  async function save() {
    if (base.length < NAME_MIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await reserveGuestName(base);
      setConflict(false);
      setName("");
    } catch (err) {
      setError(
        isNameClaimedError(err)
          ? "That one's taken too — try another."
          : err instanceof Error
            ? err.message
            : "Could not set your name.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!conflict) return null;

  const stolen = stripUsernameTag(serverUsername);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm gap-5 [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="items-center gap-3 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive ring-1 ring-destructive/25">
            <GiEvilEyes aria-hidden className="size-9" />
          </div>
          <DialogTitle className="text-xl leading-tight">
            Someone stole “{stolen}” from you. Ouch!
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            They claimed it as a permanent account handle. Track them down in the{" "}
            <span className="font-medium text-foreground">Multiplayer</span> tab and challenge them
            to a duel to reclaim your honor! Or don't - just grab another good name for now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            autoFocus
            value={name}
            maxLength={24}
            placeholder="Your new name"
            className="text-center"
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
          />
          {error && <p className="text-center text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-col gap-3 sm:flex-col sm:space-x-0">
          <Button
            className="w-full"
            disabled={busy || base.length < NAME_MIN_LENGTH}
            onClick={() => void save()}
          >
            {busy ? "Claiming…" : "Take this name"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Tip:{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => showSignIn()}
            >
              create an account
            </button>{" "}
            to claim a username for keeps - then no one can steal it!
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
