import { useState } from "react";
import { Bot, Check, ChevronDown, Copy, LockKeyhole, LogOut, Shield, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InvitePlayersDialog } from "@/components/lobby/InvitePlayersDialog";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE } from "@/types/server";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GameFormat, RoomInfo } from "@/types/server";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
const HOST_SELECTABLE_FORMATS: GameFormat[] = [
  "Standard",
  "Pioneer",
  "Modern",
  "Legacy",
  "Vintage",
  "Pauper",
  "Premodern",
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
  const [inviting, setInviting] = useState(false);
  const invitesEnabled = useServerStore((s) => s.relayFeatures.includes(RELAY_FEATURE.RoomInvites));
  const inLobby = room.status === "Lobby";
  const allowsMultiplayer = MULTIPLAYER_FORMATS.includes(room.format);
  async function copyPassword() {
    if (!roomPassword) return;
    try {
      await navigator.clipboard.writeText(roomPassword);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 1500);
      toast.success(i18n._(msg`Password copied to clipboard`));
    } catch {
      toast.error(i18n._(msg`Couldn't copy the password`));
    }
  }
  return (
    <aside className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
      <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
        <h2 className="truncate font-serif text-xl font-light">{room.room_name}</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">
              <Trans>Format</Trans>
            </dt>
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
            <dt className="text-muted-foreground">
              <Trans>Seats</Trans>
            </dt>
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
                          <Trans>
                            {count} players
                            {blockedByFormat && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (Not available in "{room.format}")
                              </span>
                            )}
                          </Trans>
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
            <dt className="text-muted-foreground">
              <Trans>Privacy</Trans>
            </dt>
            <dd className="flex items-center gap-1.5">
              {room.password_protected ? (
                <>
                  <Trans>
                    <LockKeyhole
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-format-badge-amber"
                    />
                    Password protected
                    {roomPassword && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={copyPassword}
                        title={i18n._(msg`Copy password`)}
                        aria-label={i18n._(msg`Copy password`)}
                        className="-my-1 h-7 w-7"
                      >
                        {copiedPassword ? <Check /> : <Copy />}
                      </Button>
                    )}
                  </Trans>
                </>
              ) : (
                i18n._(msg`Open table`)
              )}
            </dd>
          </div>
          {room.draft_config && (
            <>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  <Trans>Packs</Trans>
                </dt>
                <dd className="font-medium">{room.draft_config.rounds}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  <Trans>Picks per pass</Trans>
                </dt>
                <dd className="font-medium">{room.draft_config.picks_per_pass}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">
                  <Trans>Empty seats</Trans>
                </dt>
                <dd className="text-right font-medium">
                  {room.draft_config.fill_with_bots
                    ? i18n._(msg`Fill with bots`)
                    : i18n._(msg`Humans only`)}
                </dd>
              </div>
            </>
          )}
          {room.sealed_config && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">
                <Trans>Packs per player</Trans>
              </dt>
              <dd className="font-medium">{room.sealed_config.num_boosters}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="rounded-xl border bg-card/85 p-4 backdrop-blur-md">
        <h2 className="text-sm font-semibold">
          <Trans>Table controls</Trans>
        </h2>
        <div className="mt-3 grid gap-2">
          {inLobby && !isOpenFormat && !needsDeck && (
            <Button variant="outline" onClick={onOpenDeckDialog}>
              <Trans>
                <Shield /> Change deck
              </Trans>
            </Button>
          )}
          {inLobby && openSeats > 0 && invitesEnabled && (
            <Button variant="outline" onClick={() => setInviting(true)}>
              <Trans>
                <UserPlus /> Invite players
              </Trans>
            </Button>
          )}
          {inLobby && isController && openSeats > 0 && !isOpenFormat && onAddBot && (
            <Button variant="outline" onClick={onAddBot}>
              <Trans>
                <Bot /> Add a bot
              </Trans>
            </Button>
          )}
          {inLobby && !isController && myPlayerReady && (
            <Button variant="outline" onClick={() => onSetReady(false)}>
              <Trans>Change readiness</Trans>
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onLeaveRoom}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trans>
              <LogOut /> Leave table
            </Trans>
          </Button>
        </div>
      </section>

      <InvitePlayersDialog open={inviting} onClose={() => setInviting(false)} />
    </aside>
  );
}
