import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/lobby/PlayerAvatar";
import { PlayerCard } from "@/components/lobby/PlayerCard";
import { QualificationBadge } from "@/components/lobby/QualificationBadge";
import type { ChatEntry } from "@/stores/useChatStore";
import type { PlayerInfo } from "@/types/server";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";
interface ChatMessageRowProps {
  entry: ChatEntry;
  mine: boolean;
  player: PlayerInfo | undefined;
  continued: boolean;
  onReport?: (entry: ChatEntry) => void;
}
function formatTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function ChatMessageRow({ entry, mine, player, continued, onReport }: ChatMessageRowProps) {
  if (entry.system) {
    return (
      <p className="py-0.5 text-center text-ui-meta italic text-muted-foreground">{entry.text}</p>
    );
  }
  const name = stripUsernameTag(entry.from);
  const avatar = (
    <PlayerAvatar
      username={entry.from}
      avatarUrl={entry.avatarUrl}
      className="h-7 w-7 shrink-0"
      fallbackClassName="text-ui-meta"
    />
  );
  return (
    <div
      className={cn(
        "group flex items-end gap-2",
        mine && "flex-row-reverse",
        continued && "-mt-1.5",
      )}
    >
      {mine ? null : continued ? (
        <span className="w-7 touch:w-11 shrink-0" />
      ) : player ? (
        <PlayerCard
          player={player}
          status={
            <span>
              {player.room_id ? `At a table` : player.local_game ? `Playing solo` : `Available`}
            </span>
          }
          side="left"
        >
          <button
            type="button"
            className="shrink-0 rounded-full outline-none touch:min-h-11 touch:min-w-11 text-ui-label whitespace-normal"
          >
            {avatar}
          </button>
        </PlayerCard>
      ) : (
        avatar
      )}
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-lg px-3 py-2",
          mine ? "bg-primary/25" : "bg-muted/50",
        )}
      >
        {!continued && !mine && (
          <div
            className={cn(
              "mb-1 flex items-center gap-1 text-ui-meta leading-none text-muted-foreground",
              mine && "flex-row-reverse",
            )}
          >
            <span className="font-semibold text-foreground/80">{name}</span>
            <QualificationBadge qualification={entry.qualification} className="h-3.5 w-3.5" />
          </div>
        )}
        <p className="break-words text-ui-body leading-snug text-foreground/90">
          {entry.text}
          <span className="ml-2 whitespace-nowrap align-baseline text-ui-caption text-muted-foreground/70">
            {formatTime(entry.sentAtMs)}
          </span>
        </p>
      </div>
      {!mine && onReport && entry.qualification !== "maintainer" && (
        <Button
          size="icon"
          variant="ghost"
          className="min-h-6 w-6 shrink-0 self-center text-muted-foreground opacity-0 touch:opacity-100 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 touch:min-h-11 touch:min-w-11"
          onClick={() => onReport(entry)}
          aria-label={`Report ${name}`}
          title={`Report this message`}
        >
          <Flag className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
