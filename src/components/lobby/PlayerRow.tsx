import type { ReactNode } from "react";
import { PlayerAvatar } from "@/components/lobby/PlayerAvatar";
import { QualificationBadge } from "@/components/lobby/QualificationBadge";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";
import type { PlayerInfo } from "@/types/server";

export const PLAYER_ROW_ACTION_CLASS =
  "h-6 px-2 text-[11px] shrink-0 hover:bg-primary hover:text-primary-foreground hover:shadow";

interface PlayerRowProps {
  player: PlayerInfo;
  presenceDotClass: string;
  status: ReactNode;
  highlighted?: boolean;
  action?: ReactNode;
}

export function PlayerRow({
  player,
  presenceDotClass,
  status,
  highlighted = false,
  action,
}: PlayerRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-2 py-1.5 rounded-md",
        highlighted && "bg-muted/40",
        player.qualification === "maintainer" && "maintainer-row",
      )}
    >
      <div className="relative shrink-0">
        <PlayerAvatar username={player.username} avatarUrl={player.avatar_url} />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
            presenceDotClass,
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <span className="flex items-center gap-1 text-sm font-medium leading-none">
          <span className="truncate">{stripUsernameTag(player.username)}</span>
          <QualificationBadge qualification={player.qualification} />
        </span>
        {status}
      </div>
      {action}
    </div>
  );
}
