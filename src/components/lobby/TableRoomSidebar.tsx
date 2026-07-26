import { useState } from "react";
import { Bot, Check, ChevronDown, Copy, LockKeyhole, LogOut, Shield } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GameFormat, RoomInfo } from "@/types/server";

const HOST_SELECTABLE_FORMATS: GameFormat[] = [
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Pauper",
  "Commander",
  "Brawl",
  "Oathbreaker",
  "Draft",
  "Sealed",
];

const PLAYER_COUNT_OPTIONS = [2, 3, 4];

const MULTIPLAYER_FORMATS: GameFormat[] = ["Commander", "Brawl", "Oathbreaker"];

interface TableRoomSidebarProps {
  room: RoomInfo;
  roomPassword?: string | null;
  modeLabel: string;
  isController: boolean;
  isLimitedRoom: boolean;
  isOpenFormat: boolean;
  needsDeck: boolean;
  myPlayerReady: boolean;
  openSeats: number;
  onLeaveRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onSetFormat?: (format: GameFormat) => void;
  onSetMaxPlayers?: (maxPlayers: number) => void;
  onOpenDeckDialog: () => void;
  onAddBot?: () => void;
}

export function TableRoomSidebar({
  room,
  roomPassword,
  modeLabel,
  isController,
  isLimitedRoom,
  isOpenFormat,
  needsDeck,
  myPlayerReady,
  openSeats,
  onLeaveRoom,
  onSetReady,
  onSetFormat,
  onSetMaxPlayers,
  onOpenDeckDialog,
  onAddBot,
}: TableRoomSidebarProps) {
  const [copiedPassword, setCopiedPassword] = useState(false);
  const inLobby = room.status === "Lobby";
  const allowsMultiplayer = MULTIPLAYER_FORMATS.includes(room.format);

  async function copyPassword() {
    if (!roomPassword) return;
    try {
      await navigator.clipboard.writeText(roomPassword);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 1500);
      toast.success("Password copied to clipboard");
    } catch {
      toast.error("Couldn't copy the password");
    }
  }

  return (
    <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
      <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
        <h2 className="truncate font-serif text-xl font-light">{room.room_name}</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Format</dt>
            <dd>
              {inLobby && isController && !isLimitedRoom && onSetFormat ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {room.format} <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {HOST_SELECTABLE_FORMATS.map((format) => (
                      <DropdownMenuItem
                        key={format}
                        onSelect={() => onSetFormat(format)}
                        disabled={format === room.format}
                      >
                        {format}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="font-medium">{modeLabel}</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Seats</dt>
            <dd>
              {inLobby && isController && !isLimitedRoom && onSetMaxPlayers ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {room.max_players} <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PLAYER_COUNT_OPTIONS.map((count) => {
                      const blockedByFormat = count > 2 && !allowsMultiplayer;
                      return (
                        <DropdownMenuItem
                          key={count}
                          onSelect={() => onSetMaxPlayers(count)}
                          disabled={
                            blockedByFormat ||
                            count === room.max_players ||
                            count < room.players.length
                          }
                        >
                          {count} players
                          {blockedByFormat && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (Not available in "{room.format}")
                            </span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="font-medium">{room.max_players}</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Privacy</dt>
            <dd className="flex items-center gap-1.5">
              {room.password_protected ? (
                <>
                  <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 text-format-badge-amber" />
                  Password protected
                  {roomPassword && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyPassword}
                      title="Copy password"
                      aria-label="Copy password"
                      className="-my-1 h-7 w-7"
                    >
                      {copiedPassword ? <Check /> : <Copy />}
                    </Button>
                  )}
                </>
              ) : (
                "Open table"
              )}
            </dd>
          </div>
          {room.draft_config && (
            <>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Packs</dt>
                <dd className="font-medium">{room.draft_config.rounds}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Picks per pass</dt>
                <dd className="font-medium">{room.draft_config.picks_per_pass}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Empty seats</dt>
                <dd className="text-right font-medium">
                  {room.draft_config.fill_with_bots ? "Fill with bots" : "Humans only"}
                </dd>
              </div>
            </>
          )}
          {room.sealed_config && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Packs per player</dt>
              <dd className="font-medium">{room.sealed_config.num_boosters}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
        <h2 className="text-sm font-semibold">Table controls</h2>
        <div className="mt-3 grid gap-2">
          {inLobby && !isOpenFormat && !needsDeck && (
            <Button variant="outline" onClick={onOpenDeckDialog}>
              <Shield /> Change deck
            </Button>
          )}
          {inLobby && isController && openSeats > 0 && !isOpenFormat && onAddBot && (
            <Button variant="outline" onClick={onAddBot}>
              <Bot /> Add a bot
            </Button>
          )}
          {inLobby && !isController && myPlayerReady && (
            <Button variant="outline" onClick={() => onSetReady(false)}>
              Change readiness
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onLeaveRoom}
            className="text-muted-foreground hover:text-destructive"
          >
            <LogOut /> Leave table
          </Button>
        </div>
      </section>
    </aside>
  );
}
