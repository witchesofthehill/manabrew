import { useId, useState } from "react";
import { getPlatform, getPlatformType } from "@/platform";
import { Checkbox } from "@/components/ui/checkbox";
import { RELAY_FEATURE } from "@/types/server";
import { useServerStore } from "@/stores/useServerStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useForgeWasmHostingEnabled } from "@/lib/forgeWasm";
import { Check, ChevronDown, Copy, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FormatDropdown } from "@/components/FormatDropdown";
import { GAME_FORMATS } from "@/lib/formats";
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
  "Premodern",
  "Commander",
  "DuelCommander",
  "PauperCommander",
  "Brawl",
  "Oathbreaker",
  "Draft",
  "Sealed",
];
const HOST_FORMAT_OPTIONS = GAME_FORMATS.filter((format) =>
  HOST_SELECTABLE_FORMATS.some((wireFormat) => wireFormat.toLowerCase() === format.id),
);
const PLAYER_COUNT_OPTIONS = [2, 3, 4];
const MULTIPLAYER_FORMATS: GameFormat[] = ["Commander", "PauperCommander", "Brawl", "Oathbreaker"];
interface TableRoomHeaderProps {
  room: RoomInfo;
  roomPassword?: string | null;
  modeLabel: string;
  isController: boolean;
  isLimitedRoom: boolean;
  startingGame: boolean;
  onSetFormat?: (format: GameFormat) => void;
  onSetMaxPlayers?: (maxPlayers: number) => void;
}
export function TableRoomHeader({
  room,
  roomPassword,
  modeLabel,
  isController,
  isLimitedRoom,
  startingGame,
  onSetFormat,
  onSetMaxPlayers,
}: TableRoomHeaderProps) {
  const [copiedPassword, setCopiedPassword] = useState(false);
  const spectatorsEnabled = useServerStore((s) =>
    s.relayFeatures.includes(RELAY_FEATURE.Spectators),
  );
  const inLobby = room.status === "Lobby";
  const forgeAiRewindId = useId();
  const username = useServerStore((s) => s.username);
  const forgeAiRewind = useServerStore((s) => s.forgeAiRewindRoomId === room.room_id);
  const aiController = usePreferencesStore((s) => s.aiController);
  const forgeWasm = useForgeWasmHostingEnabled();
  const canUseForgeAiRewind =
    inLobby &&
    !isLimitedRoom &&
    !room.hosted &&
    room.host === username &&
    room.engine === "Forge" &&
    aiController === "forge" &&
    getPlatformType() === "web" &&
    forgeWasm &&
    room.players.some((player) => player.is_bot);
  const allowsMultiplayer = MULTIPLAYER_FORMATS.includes(room.format);
  async function copyPassword() {
    if (!roomPassword) return;
    try {
      await navigator.clipboard.writeText(roomPassword);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 1500);
      toast.success(`Password copied to clipboard`);
    } catch {
      toast.error(`Couldn't copy the password`);
    }
  }
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b px-4 py-4 sm:px-6">
      <h2 className="min-w-0 max-w-full flex-1 basis-48 truncate font-serif text-xl font-semibold">
        {room.room_name}
      </h2>
      <dl className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 text-ui-label">
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Format</dt>
          <dd>
            {inLobby && isController && !isLimitedRoom && onSetFormat ? (
              <FormatDropdown
                value={room.format.toLowerCase()}
                formats={HOST_FORMAT_OPTIONS}
                align="end"
                onValueChange={(formatId) => {
                  const format = HOST_SELECTABLE_FORMATS.find(
                    (candidate) => candidate.toLowerCase() === formatId,
                  );
                  if (format) onSetFormat(format);
                }}
              />
            ) : (
              <span className="font-medium">{modeLabel}</span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
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
                          <span className="ml-2 text-ui-meta text-muted-foreground">
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
        <div className="flex items-center gap-2">
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
                    title={`Copy password`}
                    aria-label={`Copy password`}
                    className="-my-1 min-h-7 w-7 touch:min-h-11 touch:min-w-11"
                  >
                    {copiedPassword ? <Check /> : <Copy />}
                  </Button>
                )}
              </>
            ) : (
              `Open table`
            )}
          </dd>
        </div>
        {spectatorsEnabled && room.engine === "Forge" && !isLimitedRoom && (
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">
              <label htmlFor="allow-spectators">Allow spectators</label>
            </dt>
            <dd>
              <Checkbox
                id="allow-spectators"
                checked={room.allow_spectators ?? false}
                disabled={!isController || !inLobby}
                onCheckedChange={(allow) =>
                  void getPlatform()
                    .server?.setAllowSpectators(allow === true)
                    .catch(() => toast.error("Could not update spectators."))
                }
              />
            </dd>
          </div>
        )}
        {canUseForgeAiRewind && (
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">
              <label htmlFor={forgeAiRewindId}>Experimental Forge AI rewind</label>
            </dt>
            <dd>
              <Checkbox
                id={forgeAiRewindId}
                checked={forgeAiRewind}
                disabled={startingGame}
                onCheckedChange={(checked) =>
                  useServerStore.setState({
                    forgeAiRewindRoomId: checked === true ? room.room_id : null,
                  })
                }
              />
            </dd>
          </div>
        )}
        {room.draft_config && (
          <>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Packs</dt>
              <dd className="font-medium">{room.draft_config.rounds}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Picks per pass</dt>
              <dd className="font-medium">{room.draft_config.picks_per_pass}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Pick clock</dt>
              <dd className="font-medium">
                {room.draft_config.pick_seconds ? `${room.draft_config.pick_seconds}s` : "Untimed"}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground">Empty seats</dt>
              <dd className="text-right font-medium">
                {room.draft_config.fill_with_bots ? `Fill with bots` : `Humans only`}
              </dd>
            </div>
          </>
        )}
        {room.sealed_config && (
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Packs per player</dt>
            <dd className="font-medium">{room.sealed_config.num_boosters}</dd>
          </div>
        )}
      </dl>
    </header>
  );
}
