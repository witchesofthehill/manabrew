import { useState } from "react";
import { Bot, Check, ChevronDown, Copy, Hand, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GameFormat, RoomInfo } from "@/types/server";

const HOST_SELECTABLE_FORMATS: GameFormat[] = [
  "Any",
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

interface TableRoomSidebarProps {
  room: RoomInfo;
  roomPassword?: string | null;
  modeLabel: string;
  isController: boolean;
  isLimitedRoom: boolean;
  isOpenFormat: boolean;
  needsDeck: boolean;
  canStart: boolean;
  myPlayerReady: boolean;
  openSeats: number;
  onSetReady: (ready: boolean) => void;
  onSetFormat?: (format: GameFormat) => void;
  onSetMaxPlayers?: (maxPlayers: number) => void;
  onOpenDeckDialog: () => void;
  onStartTabletop?: () => void;
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
  canStart,
  myPlayerReady,
  openSeats,
  onSetReady,
  onSetFormat,
  onSetMaxPlayers,
  onOpenDeckDialog,
  onStartTabletop,
  onAddBot,
}: TableRoomSidebarProps) {
  const [copiedPassword, setCopiedPassword] = useState(false);
  const inLobby = room.status === "Lobby";

  async function copyPassword() {
    if (!roomPassword) return;
    try {
      await navigator.clipboard.writeText(roomPassword);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 1500);
    } catch {
      return;
    }
  }

  return (
    <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Table settings</h2>
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
              {inLobby && isController && room.hosted && !isLimitedRoom && onSetMaxPlayers ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      {room.max_players} <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {PLAYER_COUNT_OPTIONS.map((count) => (
                      <DropdownMenuItem
                        key={count}
                        onSelect={() => onSetMaxPlayers(count)}
                        disabled={count === room.max_players || count < room.players.length}
                      >
                        {count} players
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="font-medium">{room.max_players}</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Privacy</dt>
            <dd className="font-medium">
              {room.password_protected ? "Password protected" : "Open table"}
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
        {room.password_protected && roomPassword && (
          <Button variant="outline" size="sm" onClick={copyPassword} className="mt-4 w-full">
            {copiedPassword ? <Check /> : <Copy />}
            {copiedPassword ? "Password copied" : "Copy password"}
          </Button>
        )}
      </section>

      {inLobby && (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Table controls</h2>
          <div className="mt-3 grid gap-2">
            {!isOpenFormat && !needsDeck && (
              <Button variant="outline" onClick={onOpenDeckDialog}>
                <Shield /> Change deck
              </Button>
            )}
            {isController && openSeats > 0 && !isOpenFormat && onAddBot && (
              <Button variant="outline" onClick={onAddBot}>
                <Bot /> Add a bot
              </Button>
            )}
            {isController && !isOpenFormat && onStartTabletop && (
              <Button variant="outline" onClick={onStartTabletop} disabled={!canStart}>
                <Hand /> Open tabletop
              </Button>
            )}
            {!isController && myPlayerReady && (
              <Button variant="outline" onClick={() => onSetReady(false)}>
                Change readiness
              </Button>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
