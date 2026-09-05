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
}

function formatTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ChatMessageRow({ entry, mine, player, continued }: ChatMessageRowProps) {
  if (entry.system) {
    return <p className="py-0.5 text-center text-sm italic text-muted-foreground">{entry.text}</p>;
  }
  const name = stripUsernameTag(entry.from);
  const avatar = (
    <PlayerAvatar
      username={entry.from}
      avatarUrl={player?.avatar_url}
      className="h-7 w-7 shrink-0"
      fallbackClassName="text-xs"
    />
  );
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse", continued && "-mt-1.5")}>
      {continued ? (
        <span className="w-7 shrink-0" />
      ) : player ? (
        <PlayerCard
          player={player}
          status={
            <span>
              {player.room_id ? "At a table" : player.local_game ? "Playing solo" : "Available"}
            </span>
          }
          side="left"
        >
          <button type="button" className="shrink-0 rounded-full">
            {avatar}
          </button>
        </PlayerCard>
      ) : (
        avatar
      )}
      <div
        className={cn("max-w-[85%] rounded-lg px-3 py-2", mine ? "bg-primary/15" : "bg-muted/50")}
      >
        {!continued && (
          <div
            className={cn(
              "mb-1 flex items-center gap-1 text-xs leading-none text-muted-foreground",
              mine && "flex-row-reverse",
            )}
          >
            <span className="font-semibold text-foreground/80">{name}</span>
            <QualificationBadge qualification={player?.qualification} className="h-3.5 w-3.5" />
          </div>
        )}
        <p className="break-words text-sm leading-snug text-foreground/90">
          {entry.text}
          <span className="ml-2 whitespace-nowrap align-baseline text-[10px] text-muted-foreground/70">
            {formatTime(entry.sentAtMs)}
          </span>
        </p>
      </div>
    </div>
  );
}
