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
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export interface ReportTarget {
  username: string;
  seal?: string;
}
interface ReportPlayerDialogProps {
  player: ReportTarget | null;
  onClose: () => void;
}
const REASONS: Array<{
  value: ChatReportReason;
  label: string;
}> = [
  {
    value: "harassment",
    get label() {
      return i18n._(msg`Harassment or bullying`);
    },
  },
  {
    value: "hate",
    get label() {
      return i18n._(msg`Hate speech`);
    },
  },
  {
    value: "inappropriate_content",
    get label() {
      return i18n._(msg`Inappropriate name or content`);
    },
  },
  {
    value: "spam",
    get label() {
      return i18n._(msg`Spam`);
    },
  },
  {
    value: "other",
    get label() {
      return i18n._(msg`Something else`);
    },
  },
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
      toast.error(error instanceof Error ? error.message : i18n._(msg`Couldn't send the report.`));
    }
  }
  if (sent) {
    return (
      <Dialog open={player != null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="flex items-center gap-2">
            <Trans>
              <ShieldCheck className="h-4 w-4 text-success" />
              Thank you
            </Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Your report has been sent.</Trans>
          </DialogDescription>
          <p className="text-sm text-foreground/90">
            <Trans>
              Your help is valuable in keeping Manabrew safe for everyone. A maintainer will look at
              this promptly and take action where it is warranted.
            </Trans>
          </p>
          <p className="text-sm text-muted-foreground">
            <Trans>
              You won&apos;t hear back about the outcome, but every report is read by a person.
            </Trans>
          </p>
          <DialogFooter>
            <Button onClick={close}>
              <Trans>Done</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={player != null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-sm">
        <DialogTitle className="flex items-center gap-2">
          <Trans>
            <Flag className="h-4 w-4" />
            Report {player ? stripUsernameTag(player.username) : ""}
          </Trans>
        </DialogTitle>
        <DialogDescription>
          <Trans>
            We take reports extremely seriously. Please do not proceed unless there is a clear
            violation of Terms of Service.
          </Trans>
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
            <Trans>Anything else? (optional)</Trans>
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
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || submitting}
            onClick={() => void submit()}
          >
            {submitting ? i18n._(msg`Sending\u2026`) : i18n._(msg`Send report`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
