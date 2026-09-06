import { useState } from "react";
import { Flag, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { reportChatPlayer } from "@/api/hub";
import type { ChatReportMessage, ChatReportReason } from "@/api/hubTypes";
import { useChatStore, type ChatEntry } from "@/stores/useChatStore";
import { useServerStore } from "@/stores/useServerStore";
import { stripUsernameTag } from "@/lib/username";
import { cn } from "@/lib/utils";

export interface ReportTarget {
  username: string;
  seal?: string;
}

interface ReportPlayerDialogProps {
  player: ReportTarget | null;
  onClose: () => void;
}

const REASONS: Array<{ value: ChatReportReason; label: string }> = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech" },
  { value: "inappropriate_content", label: "Inappropriate name or content" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

const DETAILS_MAX_CHARS = 500;

function toReportMessage(entry: ChatEntry, roomId: string | undefined): ChatReportMessage {
  return {
    from: entry.from,
    text: entry.text,
    sentAtMs: entry.sentAtMs,
    roomId,
    seal: entry.seal,
  };
}

export function ReportPlayerDialog({ player, onClose }: ReportPlayerDialogProps) {
  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  function close() {
    setReason(null);
    setDetails("");
    setSubmitting(false);
    setSent(false);
    onClose();
  }

  async function submit() {
    if (!player || !reason || submitting) return;
    setSubmitting(true);
    const chat = useChatStore.getState();
    const server = useServerStore.getState();
    const roomId = chat.roomId ?? undefined;
    try {
      await reportChatPlayer({
        reportedUsername: player.username,
        seal: player.seal,
        reason,
        details: details.trim() || undefined,
        roomId: server.currentRoom?.room_id,
        transcript: {
          general: chat.lobby.filter((e) => !e.system).map((e) => toReportMessage(e, undefined)),
          room: chat.room.filter((e) => !e.system).map((e) => toReportMessage(e, roomId)),
        },
      });
      setSent(true);
    } catch (error) {
      setSubmitting(false);
      toast.error(error instanceof Error ? error.message : "Couldn't send the report.");
    }
  }

  if (sent) {
    return (
      <Dialog open={player != null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" />
            Thank you
          </DialogTitle>
          <DialogDescription>Your report has been sent.</DialogDescription>
          <p className="text-sm text-foreground/90">
            Your help is valuable in keeping Manabrew safe for everyone. A maintainer will look at
            this promptly and take action where it is warranted.
          </p>
          <p className="text-sm text-muted-foreground">
            You won&apos;t hear back about the outcome, but every report is read by a person.
          </p>
          <DialogFooter>
            <Button onClick={close}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={player != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <Flag className="h-4 w-4" />
          Report {player ? stripUsernameTag(player.username) : ""}
        </DialogTitle>
        <DialogDescription>
          We take reports extremely seriously. Please do not proceed unless there is a clear
          violation of Terms of Service.
        </DialogDescription>
        <div className="space-y-1">
          {REASONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40",
                reason === option.value && "bg-muted/60",
              )}
            >
              <input
                type="radio"
                name="report-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="report-details" className="text-xs text-muted-foreground">
            Anything else? (optional)
          </Label>
          <textarea
            id="report-details"
            value={details}
            maxLength={DETAILS_MAX_CHARS}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || submitting}
            onClick={() => void submit()}
          >
            {submitting ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
