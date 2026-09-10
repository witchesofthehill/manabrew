import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNameClaimedError, reserveGuestName } from "@/lib/guestName";
import { stripUsernameTag } from "@/lib/username";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
      toast.success(i18n._(msg`Username updated`));
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
      <Label htmlFor="guest-username">
        <Trans>Username</Trans>
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id="guest-username"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) void save();
          }}
          placeholder={i18n._(msg`Player1`)}
        />
        <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? i18n._(msg`Saving\u2026`) : i18n._(msg`Save`)}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        <Trans>Playing as a guest.</Trans>
      </p>
    </div>
  );
}
