import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChooseFormatDialog } from "@/components/lobby/ChooseFormatDialog";
import { JoinPasswordDialog } from "@/components/lobby/JoinPasswordDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Hand,
  Users,
  Swords,
  Shield,
  LogOut,
  Bot,
  X,
  ChevronDown,
  BadgeCheck,
  Lock,
  Cpu,
  Anvil,
  Search,
  Copy,
  Check,
} from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import type { GameFormat, RoomInfo } from "@/types/server";
import { PROTOCOL_VERSION } from "@/protocol";
import { getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

const HIDDEN_ROOM_NAMES = new Set(["free room", "free pod"]);

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

const TAG_CLASSES: Record<string, string> = {
  official: "bg-primary text-primary-foreground",
  blue: "bg-format-badge-blue/15 text-format-badge-blue",
  amber: "bg-format-badge-amber/15 text-format-badge-amber",
  emerald: "bg-format-badge-emerald/15 text-format-badge-emerald",
  rose: "bg-format-badge-rose/15 text-format-badge-rose",
  slate: "bg-format-badge-slate/15 text-format-badge-slate",
  zinc: "bg-format-badge-zinc/15 text-format-badge-zinc",
  purple: "bg-format-badge-purple/15 text-format-badge-purple",
  teal: "bg-format-badge-teal/15 text-format-badge-teal",
  orange: "bg-format-badge-orange/15 text-format-badge-orange",
  sky: "bg-format-badge-sky/15 text-format-badge-sky",
  indigo: "bg-format-badge-indigo/15 text-format-badge-indigo",
  neutral: "bg-muted text-muted-foreground",
};

function LobbyTag({
  tone,
  className,
  children,
}: {
  tone: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold leading-tight",
        TAG_CLASSES[tone] ?? TAG_CLASSES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

function needsFormatChoice(room: RoomInfo) {
  return (
    room.format === "Any" &&
    !room.draft_config &&
    !room.sealed_config &&
    room.players.every((p) => p.is_bot)
  );
}

interface TablesListProps {
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  roomPassword?: string | null;
  username: string | null;
  onNewGame: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
  onJoinRoom: (roomId: string, password?: string, format?: GameFormat) => Promise<void>;
  onLeaveRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onSetFormat?: (format: GameFormat) => void;
  onSetMaxPlayers?: (maxPlayers: number) => void;
  onOpenDeckDialog: () => void;
  onStartGame: () => void;
  onStartTabletop?: () => void;
  onStartDraft?: () => void;
  onStartSealed?: () => void;
  startingLimited?: boolean;
  startingGame?: boolean;
  onAddBot?: () => void;
  onRemoveBot?: (username: string) => void;
  /** Bots this host process spawned — used to show the remove button. The
   *  relay has no isBot field; tracking lives client-local. */
  mySpawnedBots?: string[];
}

export function TablesList({
  rooms,
  currentRoom,
  roomPassword,
  username,
  onJoinRoom,
  onLeaveRoom,
  onSetReady,
  onSetFormat,
  onSetMaxPlayers,
  onOpenDeckDialog,
  onStartGame,
  onStartTabletop,
  onStartDraft,
  onStartSealed,
  startingLimited = false,
  startingGame = false,
  onAddBot,
  onRemoveBot,
  mySpawnedBots = [],
}: TablesListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [passwordRoom, setPasswordRoom] = useState<RoomInfo | null>(null);
  const [formatRoom, setFormatRoom] = useState<RoomInfo | null>(null);
  const [formatAfterJoin, setFormatAfterJoin] = useState(false);
  const [search, setSearch] = useState("");
  const [copiedPassword, setCopiedPassword] = useState(false);

  const inRoom = currentRoom != null;
  const myPlayer = currentRoom?.players.find((p) => p.username === username);
  const myPlayerHasDeck = !!myPlayer?.selected_deck_name;
  // The controller is the first human (non-bot) player — they drive the lobby
  // (format, seats, bots, start) even when the host is a non-playing engine
  // node. Mirrors the server's Room::controller_id: first non-bot seat, falling
  // back to the first seat only if every player is a bot.
  const controllerName =
    currentRoom?.players.find((p) => !p.is_bot)?.username ?? currentRoom?.players[0]?.username;
  const isController = controllerName === username;
  const isLimitedRoom = !!(currentRoom?.draft_config || currentRoom?.sealed_config);
  const isOpenFormat = currentRoom?.format === "Any" || isLimitedRoom;
  const minReady = isOpenFormat ? 1 : 2;
  const allOtherPlayersReady = currentRoom
    ? currentRoom.players.length >= minReady &&
      currentRoom.players.filter((p) => p.username !== controllerName).every((p) => p.ready)
    : false;
  const controllerHasDeck =
    isOpenFormat ||
    !!currentRoom?.players.find((p) => p.username === controllerName)?.selected_deck_name;
  const canStart = currentRoom?.status === "Lobby" && allOtherPlayersReady && controllerHasDeck;
  const readyDisabled = !isOpenFormat && !myPlayerHasDeck;

  const orderedPlayers = currentRoom
    ? [...currentRoom.players].sort((a, b) => {
        if (a.username === controllerName) return -1;
        if (b.username === controllerName) return 1;
        return a.username.localeCompare(b.username);
      })
    : [];

  async function handleJoinRoom(roomId: string, password?: string, format?: GameFormat) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId, password, format);
    } finally {
      setJoiningRoomId(null);
    }
  }

  function requestJoin(room: RoomInfo) {
    if (room.password_protected) {
      setPasswordRoom(room);
    } else if (needsFormatChoice(room)) {
      setFormatAfterJoin(false);
      setFormatRoom(room);
    } else {
      void handleJoinRoom(room.room_id);
    }
  }

  async function joinThenChooseFormat(room: RoomInfo, password: string) {
    await onJoinRoom(room.room_id, password);
    if (needsFormatChoice(room)) {
      setFormatAfterJoin(true);
      setFormatRoom(room);
    }
  }

  const trimmedSearch = search.trim().toLowerCase();
  const visibleRooms = rooms
    .filter(
      (room) =>
        room.room_id === currentRoom?.room_id ||
        !HIDDEN_ROOM_NAMES.has(room.room_name.trim().toLowerCase()),
    )
    .filter((room) => room.status === "Lobby" || room.room_id === currentRoom?.room_id)
    .filter(
      (room) =>
        !trimmedSearch ||
        room.room_name.toLowerCase().includes(trimmedSearch) ||
        room.host.toLowerCase().includes(trimmedSearch),
    );

  return (
    <div className="h-full flex flex-col">
      {/* Current room card */}
      {currentRoom && (
        <div className="p-4 border-b">
          <div className="rounded-xl border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Swords className="h-4 w-4 text-primary shrink-0" />
                <span className="font-semibold text-sm truncate">{currentRoom.room_name}</span>
                {currentRoom.password_protected && roomPassword && (
                  <button
                    type="button"
                    title="Copy room password"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(roomPassword);
                        setCopiedPassword(true);
                        setTimeout(() => setCopiedPassword(false), 1500);
                      } catch {
                        // clipboard unavailable
                      }
                    }}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted/60"
                  >
                    {copiedPassword ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : (
                      <Copy className="h-2.5 w-2.5" />
                    )}
                    {copiedPassword ? "Copied" : "Password"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {currentRoom.draft_config && (
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {currentRoom.draft_config.cube_name ?? currentRoom.draft_config.set_code}
                  </Badge>
                )}
                {currentRoom.sealed_config && (
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {currentRoom.sealed_config.set_code}
                  </Badge>
                )}
                {isController &&
                currentRoom.status === "Lobby" &&
                onSetFormat &&
                !currentRoom.draft_config &&
                !currentRoom.sealed_config ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[10px] font-medium hover:bg-muted/60"
                      >
                        {currentRoom.format}
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {HOST_SELECTABLE_FORMATS.map((f) => (
                        <DropdownMenuItem
                          key={f}
                          onSelect={() => onSetFormat(f)}
                          disabled={f === currentRoom.format}
                          className="text-xs"
                        >
                          {f}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    {isOpenFormat && currentRoom.draft_config
                      ? currentRoom.draft_config.cube_id
                        ? "Cube"
                        : "Draft"
                      : isOpenFormat && currentRoom.sealed_config
                        ? "Sealed"
                        : currentRoom.format}
                  </Badge>
                )}
                {isController &&
                currentRoom.status === "Lobby" &&
                currentRoom.hosted &&
                !isLimitedRoom &&
                onSetMaxPlayers ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[10px] font-medium hover:bg-muted/60"
                        title="Change the number of seats"
                      >
                        <Users className="h-2.5 w-2.5" />
                        {currentRoom.players.length}/{currentRoom.max_players}
                        <ChevronDown className="h-2.5 w-2.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {PLAYER_COUNT_OPTIONS.map((n) => (
                        <DropdownMenuItem
                          key={n}
                          onSelect={() => onSetMaxPlayers(n)}
                          disabled={n === currentRoom.max_players || n < currentRoom.players.length}
                          className="text-xs"
                        >
                          {n} players
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Users className="h-2.5 w-2.5" />
                    {currentRoom.players.length}/{currentRoom.max_players}
                  </Badge>
                )}
                <Badge
                  variant={currentRoom.status === "Lobby" ? "outline" : "secondary"}
                  className="text-[10px]"
                >
                  {currentRoom.status}
                </Badge>
              </div>
            </div>

            {currentRoom.draft_config && (
              <div className="text-[11px] text-muted-foreground">
                {currentRoom.draft_config.rounds} packs · {currentRoom.draft_config.picks_per_pass}{" "}
                pick{currentRoom.draft_config.picks_per_pass === 1 ? "" : "s"}/pass
                {currentRoom.draft_config.fill_with_bots
                  ? " · empty seats fill with bots"
                  : " · humans only"}
              </div>
            )}
            {currentRoom.sealed_config && (
              <div className="text-[11px] text-muted-foreground">
                {currentRoom.sealed_config.num_boosters} packs per player · each player opens their
                own pool
              </div>
            )}

            {/* Player slots */}
            <div className="grid gap-2 sm:grid-cols-2">
              {orderedPlayers.map((p) => {
                const canRemove = mySpawnedBots.includes(p.username);
                const isPlayerController = p.username === controllerName;
                return (
                  <div
                    key={p.username}
                    className={cn(
                      "rounded-lg border px-3 py-2 min-h-[3.25rem] flex items-center gap-2.5 transition-colors",
                      p.ready || isPlayerController
                        ? "border-primary/30 bg-primary/5"
                        : "bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        p.ready || isPlayerController ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {stripUsernameTag(p.username)}
                        </span>
                        {p.username === controllerName && (
                          <GameIcon
                            name="overlord-helm"
                            className="h-3 w-3 text-commander shrink-0"
                            title="Room host — controls seats, bots & start"
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {isPlayerController
                          ? "Controls start"
                          : isOpenFormat
                            ? p.ready
                              ? "Ready"
                              : "Waiting to ready up"
                            : (p.selected_deck_name ?? "No deck selected")}
                      </div>
                    </div>
                    {canRemove && isController ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveBot?.(p.username)}
                        title="Remove bot"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Badge
                        variant={p.ready ? "default" : "outline"}
                        className={cn(
                          "text-[9px] px-1.5 shrink-0",
                          (p.ready || isPlayerController) &&
                            "bg-primary border-primary text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {isPlayerController ? "Controller" : p.ready ? "Ready" : "Waiting"}
                      </Badge>
                    )}
                  </div>
                );
              })}
              {/* Hidden on Open rooms — draft bots come from the room's
                  draft_config.fill_with_bots, not this deck-picker flow. */}
              {isController &&
                !isOpenFormat &&
                currentRoom.players.length < currentRoom.max_players &&
                onAddBot && (
                  <button
                    className="rounded-lg border border-dashed px-3 py-2 min-h-[3.25rem] flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
                    onClick={onAddBot}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Add Bot
                  </button>
                )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isOpenFormat && (
                <Button size="sm" variant="outline" className="gap-1" onClick={onOpenDeckDialog}>
                  <Shield className="h-3 w-3" /> Select Deck
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={onLeaveRoom}
              >
                <LogOut className="h-3 w-3" /> Leave
              </Button>
              {isController && (
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {onStartTabletop && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={onStartTabletop}
                      disabled={!canStart}
                    >
                      <Hand className="h-3 w-3" /> Tabletop
                    </Button>
                  )}
                  {onStartDraft && isOpenFormat && currentRoom.draft_config && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={onStartDraft}
                      disabled={!canStart || startingLimited}
                      title={!allOtherPlayersReady ? "All other players must be ready" : undefined}
                    >
                      <Swords className="h-3 w-3" />
                      {startingLimited ? "Starting…" : "Start Draft"}
                    </Button>
                  )}
                  {onStartSealed && isOpenFormat && currentRoom.sealed_config && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={onStartSealed}
                      disabled={!canStart || startingLimited}
                      title={!allOtherPlayersReady ? "All other players must be ready" : undefined}
                    >
                      <Swords className="h-3 w-3" />
                      {startingLimited ? "Starting…" : "Start Sealed"}
                    </Button>
                  )}
                  {!isOpenFormat && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => onStartGame()}
                      disabled={!canStart || startingGame}
                      title={
                        !controllerHasDeck
                          ? "Select a deck before starting"
                          : !allOtherPlayersReady
                            ? "All other players must be ready"
                            : undefined
                      }
                    >
                      <Swords className="h-3 w-3" /> {startingGame ? "Starting…" : "Start Game"}
                    </Button>
                  )}
                  {!canStart && (
                    <p className="hidden w-full text-right text-[10px] text-muted-foreground pointer-coarse:block">
                      {!controllerHasDeck && !isOpenFormat
                        ? "Select a deck before starting"
                        : "All other players must be ready"}
                    </p>
                  )}
                </div>
              )}
              {!isController && currentRoom.status === "Lobby" && myPlayer && (
                <div className="ml-auto flex items-center gap-2">
                  {!myPlayer.ready ? (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={() => onSetReady(true)}
                      disabled={readyDisabled}
                    >
                      Ready
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => onSetReady(false)}>
                      UnReady
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room search */}
      {!inRoom && rooms.length > 0 && (
        <div className="px-4 pt-1 pb-1 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rooms…"
              className="h-8 pl-8 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
            />
          </div>
        </div>
      )}

      {/* Room list */}
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 pt-2">
          {visibleRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-20">🎮</div>
              <p className="text-sm text-muted-foreground">
                {rooms.length === 0 ? "No rooms available" : "No rooms match your search"}
              </p>
              {rooms.length === 0 && (
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create a new room to start playing
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y overflow-hidden rounded-lg border bg-card/40">
              {visibleRooms.map((room) => {
                const isMyRoom = room.room_id === currentRoom?.room_id;
                const isCompatible = room.protocol_version === PROTOCOL_VERSION;
                const canJoin =
                  isCompatible &&
                  !inRoom &&
                  room.status === "Lobby" &&
                  room.players.length < room.max_players;
                const isFull = room.players.length >= room.max_players;
                const format = getFormat(room.format.toLowerCase());
                const modeLabel = format?.name ?? room.format;
                const modeTone = format?.badgeColor ?? "neutral";
                const limitedLabel = room.draft_config
                  ? (room.draft_config.cube_name ?? room.draft_config.set_code)
                  : room.sealed_config
                    ? room.sealed_config.set_code
                    : null;
                const showHost = !room.official && !room.hosted;

                return (
                  <div
                    key={room.room_id}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 transition-colors",
                      isMyRoom && "bg-primary/5",
                      !isMyRoom && canJoin && "hover:bg-muted/40 cursor-pointer",
                      !isCompatible && "opacity-60",
                    )}
                    onClick={() => {
                      if (canJoin) requestJoin(room);
                    }}
                  >
                    {(room.official || room.password_protected) && (
                      <div className="flex items-center gap-1 shrink-0">
                        {room.official && (
                          <span title="Official room" className="inline-flex">
                            <BadgeCheck className="h-4 w-4 text-primary" />
                          </span>
                        )}
                        {room.password_protected && (
                          <span title="Private room" className="inline-flex">
                            <Lock className="h-3.5 w-3.5 text-format-badge-amber" />
                          </span>
                        )}
                      </div>
                    )}

                    <span className="font-medium text-sm truncate min-w-0">{room.room_name}</span>

                    {!isCompatible && (
                      <LobbyTag tone="rose" className="shrink-0">
                        Incompatible
                      </LobbyTag>
                    )}
                    <LobbyTag tone={room.engine === "Forge" ? "blue" : "sky"} className="shrink-0">
                      {room.engine === "Forge" ? (
                        <Anvil className="h-3 w-3" />
                      ) : (
                        <Cpu className="h-3 w-3" />
                      )}
                      {room.engine === "Forge" ? "Forge" : "Manabrew"}
                    </LobbyTag>
                    {room.format !== "Any" && (
                      <LobbyTag tone={modeTone} className="shrink-0">
                        {modeLabel}
                      </LobbyTag>
                    )}
                    {limitedLabel && (
                      <LobbyTag tone="purple" className="uppercase max-w-[7rem] truncate shrink-0">
                        {limitedLabel}
                      </LobbyTag>
                    )}
                    {showHost && (
                      <span className="hidden truncate text-[11px] text-muted-foreground sm:block max-w-[9rem]">
                        by {room.host}
                      </span>
                    )}

                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span>
                          {room.players.length}/{room.max_players}
                        </span>
                      </div>
                      {isMyRoom ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Joined
                        </Badge>
                      ) : canJoin ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-6 text-[11px] px-2"
                          disabled={joiningRoomId === room.room_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            requestJoin(room);
                          }}
                        >
                          {joiningRoomId === room.room_id ? "Joining..." : "Join"}
                        </Button>
                      ) : room.status === "InGame" ? (
                        <span className="text-[10px] text-muted-foreground">Playing</span>
                      ) : isFull ? (
                        <span className="text-[10px] text-muted-foreground">Full</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      <JoinPasswordDialog
        room={passwordRoom}
        onClose={() => setPasswordRoom(null)}
        onJoin={(room, password) => joinThenChooseFormat(room, password)}
      />

      <ChooseFormatDialog
        room={formatRoom}
        onClose={() => setFormatRoom(null)}
        onSelect={(room, format) => {
          if (formatAfterJoin) {
            onSetFormat?.(format);
          } else {
            void handleJoinRoom(room.room_id, undefined, format);
          }
        }}
      />
    </div>
  );
}
