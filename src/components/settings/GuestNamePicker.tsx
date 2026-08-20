import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNameClaimedError, reserveGuestName } from "@/lib/guestName";
import { stripUsernameTag } from "@/lib/username";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function GuestNamePicker() {
  const serverUsername = usePreferencesStore((s) => s.serverUsername);
  const [name, setName] = useState(stripUsernameTag(serverUsername));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = name.trim();
  const dirty = base.length > 0 && base !== stripUsernameTag(serverUsername);

  async function save() {
    if (!base) return;
    setBusy(true);
    setError(null);
    try {
      await reserveGuestName(base);
      toast.success("Username updated");
    } catch (err) {
      setError(
        isNameClaimedError(err)
          ? "That name is already claimed. Pick another."
          : err instanceof Error
            ? err.message
            : "Could not update username",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="guest-username">Username</Label>
      <div className="flex items-center gap-2">
        <Input
          id="guest-username"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Player1"
        />
        <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        Your name in multiplayer. Sign in to claim it permanently.
      </p>
    </div>
  );
}
