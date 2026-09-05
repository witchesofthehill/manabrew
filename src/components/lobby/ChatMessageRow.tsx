import { PlayerAvatar } from "@/components/lobby/PlayerAvatar";
import { QualificationBadge } from "@/components/lobby/QualificationBadge";
import type { ChatEntry } from "@/stores/useChatStore";
import type { PlayerInfo } from "@/types/server";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

interface ChatMessageRowProps {
  entry: ChatEntry;
  mine: boolean;
  player: PlayerInfo | undefined;
}

function formatTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatMessageRow({ entry, mine, player }: ChatMessageRowProps) {
  if (entry.system) {
    return <p className="py-0.5 text-center text-xs italic text-muted-foreground">{entry.text}</p>;
  }
  const name = stripUsernameTag(entry.from);
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      <PlayerAvatar
        username={entry.from}
        avatarUrl={player?.avatar_url}
        className="h-6 w-6 shrink-0"
        fallbackClassName="text-[10px]"
      />
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-2.5 py-1.5",
          mine ? "bg-primary/15" : "bg-muted/50",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1 text-[10px] leading-none text-muted-foreground",
            mine && "flex-row-reverse",
          )}
        >
          <span className="font-semibold text-foreground/80">{name}</span>
          <QualificationBadge qualification={player?.qualification} className="h-3 w-3" />
          <span>{formatTime(entry.sentAtMs)}</span>
        </div>
        <p className="mt-1 break-words text-xs leading-snug text-foreground/90">{entry.text}</p>
      </div>
    </div>
  );
}
