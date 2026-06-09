import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import type { PlayerInfo } from "@/types/server";
import { cn } from "@/lib/utils";

export type ConnectionState = "connected" | "connecting" | "disconnected";

interface UserListProps {
  players: PlayerInfo[];
  currentPlayerId: string | null;
  currentUsername: string | null;
  connectionState: ConnectionState;
}

const CONNECTION_STATUS: Record<
  ConnectionState,
  { dot: string; text: string; label: string; Icon: typeof Wifi }
> = {
  connected: { dot: "bg-primary", text: "text-primary", label: "Connected", Icon: Wifi },
  connecting: {
    dot: "bg-format-badge-amber",
    text: "text-muted-foreground",
    label: "Connecting…",
    Icon: Loader2,
  },
  disconnected: {
    dot: "bg-destructive",
    text: "text-destructive",
    label: "Disconnected",
    Icon: WifiOff,
  },
};

export function UserList({
  players,
  currentPlayerId,
  currentUsername,
  connectionState,
}: UserListProps) {
  const myEntry = players.find(
    (p) =>
      (currentPlayerId != null && p.player_id === currentPlayerId) ||
      (currentUsername != null && p.username === currentUsername),
  );
  const others = players.filter((p) => p !== myEntry);
  const myUsername = myEntry?.username ?? currentUsername;
  const status = CONNECTION_STATUS[connectionState];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 h-14 border-b shrink-0 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Players</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {players.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1">
          {myUsername && (
            <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-muted/40">
              <div className="relative shrink-0">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">
                    {myUsername.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
                    status.dot,
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium leading-none truncate block">
                  {myUsername} <span className="text-muted-foreground font-normal">(You)</span>
                </span>
                <span className={cn("flex items-center gap-1 text-[10px]", status.text)}>
                  <status.Icon
                    className={cn(
                      "h-2.5 w-2.5",
                      connectionState === "connecting" && "animate-spin",
                    )}
                  />
                  {status.label}
                </span>
              </div>
            </div>
          )}

          {others.map((player) => (
            <div
              key={player.player_id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
            >
              <div className="relative shrink-0">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-[10px]">
                    {player.username.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-background",
                    player.connected ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium leading-none truncate block">
                  {player.username}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {player.room_id ? "In room" : "In lobby"}
                </span>
              </div>
            </div>
          ))}

          {!myUsername && others.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-6">
              No players online
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
