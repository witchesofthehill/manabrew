import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlayerAvatar } from "@/components/lobby/PlayerAvatar";
import { QualificationBadge } from "@/components/lobby/QualificationBadge";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";
import type { PlayerInfo } from "@/types/server";

const QUALIFICATION_LABEL: Record<string, string> = { maintainer: "Maintainer" };

interface PlayerCardProps {
  player: PlayerInfo;
  status: ReactNode;
  action?: ReactNode;
  side?: "left" | "right" | "top" | "bottom";
  children: ReactNode;
}

export function PlayerCard({ player, status, action, side = "left", children }: PlayerCardProps) {
  const name = stripUsernameTag(player.username);
  const tag = player.username.slice(name.length);
  const qualification = player.qualification ? QUALIFICATION_LABEL[player.qualification] : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="start" sideOffset={8} className="w-64 p-0">
        <div
          className={cn(
            "h-12 rounded-t-md bg-primary/20",
            player.qualification === "maintainer" && "maintainer-row",
          )}
        />
        <div className="-mt-8 px-4 pb-4">
          <div className="relative w-fit rounded-full border-4 border-popover">
            <PlayerAvatar
              username={player.username}
              avatarUrl={player.avatar_url}
              className="h-16 w-16"
              fallbackClassName="text-xl"
            />
            <span
              className={
                player.connected
                  ? "absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-popover bg-success"
                  : "absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-popover bg-muted-foreground/40"
              }
            />
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="truncate text-base font-semibold leading-tight">{name}</span>
            <QualificationBadge qualification={player.qualification} className="h-4 w-4" />
          </div>
          {tag && <p className="text-xs text-muted-foreground">{tag}</p>}
          {qualification && (
            <p className="mt-1 text-xs font-medium text-format-badge-amber">{qualification}</p>
          )}
          <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">{status}</div>
          {action && <div className="mt-3 flex justify-end">{action}</div>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
