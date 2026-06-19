import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOIN_REJECTED_INCORRECT_PASSWORD } from "@/stores/useServerStore";
import type { RoomInfo } from "@/types/server";

interface JoinPasswordDialogProps {
  room: RoomInfo | null;
  onClose: () => void;
  onJoin: (room: RoomInfo, password: string) => Promise<void>;
}

export function JoinPasswordDialog({ room, onClose, onJoin }: JoinPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function close() {
    setPassword("");
    setError(null);
    setSubmitting(false);
    onClose();
  }

  async function submit() {
    if (!room || password.length === 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await onJoin(room, password);
      close();
    } catch (e) {
      setPassword("");
      setError(
        e instanceof Error && e.message === JOIN_REJECTED_INCORRECT_PASSWORD
          ? "Wrong password"
          : "Couldn't join — try again",
      );
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={room != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Private room
        </DialogTitle>
        <DialogDescription>Enter the password to join {room?.room_name}.</DialogDescription>

        <div className="space-y-1.5">
          <div
            onClick={() => inputRef.current?.focus()}
            className={cn(
              "relative flex h-16 cursor-text items-center justify-center gap-1.5 overflow-hidden rounded-lg border-2 bg-muted/40 px-4 transition-all",
              focused ? "border-ring bg-muted/60 ring-2 ring-ring/40" : "border-input",
            )}
          >
            <input
              ref={inputRef}
              type="password"
              autoFocus
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              aria-label="Password"
              className="absolute inset-0 h-full w-full cursor-text opacity-0"
            />
            {password.length === 0 && !focused && (
              <span className="text-sm text-muted-foreground">Enter password</span>
            )}
            {password.split("").map((_, i) => (
              <span key={i} className="shrink-0 translate-y-[0.5em] select-none leading-none">
                <span className="animate-password-pip inline-block text-3xl font-black text-primary">
                  *
                </span>
              </span>
            ))}
            {focused && (
              <span className="animate-password-caret h-7 w-0.5 shrink-0 rounded-full bg-foreground" />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={password.length === 0 || submitting}>
            {submitting ? "Joining…" : "Join"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
