import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { updateHandle, AuthRequestError } from "@/api/auth";
import { useAuthStore } from "@/stores/useAuthStore";

interface HandleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HandleDialog({ open, onOpenChange }: HandleDialogProps) {
  const account = useAuthStore((s) => s.account);
  const setAccount = useAuthStore((s) => s.setAccount);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setHandle(account?.handle ?? "");
      setError(null);
      setBusy(false);
    }
  }, [open, account]);

  async function handleSave() {
    const token = useAuthStore.getState().token;
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateHandle(token, handle.trim());
      setAccount(updated);
      toast.success(`Handle updated to @${updated.handle}`);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof AuthRequestError && err.status === 409) {
        setError("That handle is already taken");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Change handle</DialogTitle>
          <DialogDescription>
            Your handle is your public name on the Deck Hub. 3-24 characters: letters, digits, _ and
            -.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="account-handle">Handle</Label>
          <Input
            id="account-handle"
            value={handle}
            maxLength={24}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && handle.trim().length >= 3) void handleSave();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || handle.trim().length < 3 || handle.trim() === account?.handle}
            onClick={() => void handleSave()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
