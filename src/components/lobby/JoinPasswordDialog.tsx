import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lock } from "lucide-react";
import type { RoomInfo } from "@/types/server";

interface JoinPasswordDialogProps {
  room: RoomInfo | null;
  onClose: () => void;
  onSubmit: (roomId: string, password: string) => void;
}

export function JoinPasswordDialog({ room, onClose, onSubmit }: JoinPasswordDialogProps) {
  const [password, setPassword] = useState("");

  function close() {
    setPassword("");
    onClose();
  }

  function submit() {
    if (!room) return;
    onSubmit(room.room_id, password);
    close();
  }

  return (
    <Dialog open={room != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <Lock className="h-4 w-4" />
          Private room
        </DialogTitle>
        <DialogDescription>Enter the password to join {room?.room_name}.</DialogDescription>
        <Input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Password"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={password.length === 0}>
            Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
