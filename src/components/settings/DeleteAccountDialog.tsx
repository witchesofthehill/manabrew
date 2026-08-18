import { useState } from "react";
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
import { deleteAccount } from "@/api/auth";
import { getAccessToken, useAuthStore } from "@/stores/useAuthStore";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteAccountDialog({ open, onOpenChange }: DeleteAccountDialogProps) {
  const account = useAuthStore((s) => s.account);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setConfirmation("");
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  }

  const handle = account?.handle ?? "";
  const confirmed = confirmation.trim().toLowerCase() === handle.toLowerCase();

  async function handleDelete() {
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(token);
      await useAuthStore.getState().signOut();
      onOpenChange(false);
      toast.success("Your account has been deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This erases your account, sign-in methods, saved decks and version history. Decks you
            published to Community stay up without your name on them. This cannot be undone — export
            your data first if you want a copy.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-account-confirm">Type {handle} to confirm</Label>
          <Input
            id="delete-account-confirm"
            value={confirmation}
            autoComplete="off"
            onChange={(e) => setConfirmation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmed) void handleDelete();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !confirmed}
            onClick={() => void handleDelete()}
          >
            {busy ? "Deleting…" : "Delete account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
