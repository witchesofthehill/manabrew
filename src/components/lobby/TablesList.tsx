import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChooseFormatDialog } from "@/components/lobby/ChooseFormatDialog";
import { HostedTablesSection } from "@/components/lobby/HostedTablesSection";
import { JoinPasswordDialog } from "@/components/lobby/JoinPasswordDialog";
import { OpenTableCard } from "@/components/lobby/OpenTableCard";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { needsFormatChoice } from "@/components/lobby/tables.utils";
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
  ChevronDown,
  Search,
  Copy,
  Check,
  Table2,
} from "lucide-react";
import type { GameFormat, RoomInfo } from "@/types/server";
import { PROTOCOL_VERSION } from "@/protocol";
import { SERVER_ERROR_CODE, USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type { ServerErrorCode } from "@/types/server";
import { toast } from "sonner";

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
];

const PLAYER_COUNT_OPTIONS = [2, 3, 4];
const HOSTED_JOIN_RETRY_CODES: ReadonlySet<string> = new Set([
  SERVER_ERROR_CODE.RoomFull,
  SERVER_ERROR_CODE.RoomNotFound,
]);

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
  const [hostedFormatRooms, setHostedFormatRooms] = useState<RoomInfo[] | null>(null);
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
  const readyCount = currentRoom
    ? currentRoom.players.filter((p) => p.ready || p.username === controllerName).length
    : 0;

  async function handleJoinRoom(roomId: string, password?: string, format?: GameFormat) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId, password, format);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const message = USER_FACING_ERROR_MESSAGES[code as ServerErrorCode];
      toast.error(message ?? "Couldn't join the table.");
    } finally {
      setJoiningRoomId(null);
    }
  }

  async function handleJoinHostedRooms(roomCandidates: RoomInfo[], format: GameFormat) {
    if (joiningRoomId) return;
    try {
      for (const room of roomCandidates) {
        setJoiningRoomId(room.room_id);
        try {
          await onJoinRoom(room.room_id, undefined, format);
          return;
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          if (HOSTED_JOIN_RETRY_CODES.has(code)) continue;
          const message = USER_FACING_ERROR_MESSAGES[code as ServerErrorCode];
          toast.error(message ?? "Couldn't join the hosted table.");
          return;
        }
      }
      toast.error("Hosted capacity changed. Choose a table again.");
    } finally {
      setJoiningRoomId(null);
    }
  }

  function requestJoin(room: RoomInfo) {
    setHostedFormatRooms(null);
    if (room.password_protected) {
      setPasswordRoom(room);
    } else if (needsFormatChoice(room)) {
      setFormatAfterJoin(false);
      setFormatRoom(room);
    } else {
      void handleJoinRoom(room.room_id);
    }
  }

  function requestHostedJoin(roomCandidates: RoomInfo[]) {
    const targetRoom = roomCandidates[0];
    if (!targetRoom) return;
    setFormatAfterJoin(false);
    setHostedFormatRooms(roomCandidates);
    setFormatRoom(targetRoom);
  }

  async function joinThenChooseFormat(room: RoomInfo, password: string) {
    await onJoinRoom(room.room_id, password);
    if (needsFormatChoice(room)) {
      setFormatAfterJoin(true);
      setFormatRoom(room);
    }
  }

  const trimmedSearch = search.trim().toLowerCase();
  const hostedRoomsByEngine = rooms.reduce<Map<RoomInfo["engine"], RoomInfo[]>>((groups, room) => {
    const canAggregate =
      room.official &&
      room.hosted &&
      room.status === "Lobby" &&
      room.players.length === 0 &&
      room.room_id !== currentRoom?.room_id &&
      !room.password_protected &&
      !room.draft_config &&
      !room.sealed_config &&
      room.format === "Any" &&
      room.protocol_version === PROTOCOL_VERSION;
    if (!canAggregate) return groups;
    const engineRooms = groups.get(room.engine) ?? [];
    engineRooms.push(room);
    groups.set(room.engine, engineRooms);
    return groups;
  }, new Map());
  const hostedRoomGroups = [...hostedRoomsByEngine.entries()];
  const aggregatedRoomIds = new Set(
    hostedRoomGroups.flatMap(([, engineRooms]) => engineRooms.map((r) => r.room_id)),
  );
  const ordinaryRooms = rooms
    .filter((room) => !aggregatedRoomIds.has(room.room_id))
    .filter((room) => room.room_id !== currentRoom?.room_id)
    .filter((room) => !HIDDEN_ROOM_NAMES.has(room.room_name.trim().toLowerCase()))
    .filter((room) => room.status === "Lobby");
  const visibleHostedRoomGroups = hostedRoomGroups.filter(
    ([engine, engineRooms]) =>
      !trimmedSearch ||
      engine.toLowerCase().includes(trimmedSearch) ||
      "hosted tables".includes(trimmedSearch) ||
      engineRooms.some((room) => room.room_name.toLowerCase().includes(trimmedSearch)),
  );
  const visibleRooms = ordinaryRooms.filter(
    (room) =>
      !trimmedSearch ||
      room.room_name.toLowerCase().includes(trimmedSearch) ||
      room.host.toLowerCase().includes(trimmedSearch),
  );
  const hasTables = hostedRoomGroups.length > 0 || ordinaryRooms.length > 0;
  const hasVisibleTables = visibleHostedRoomGroups.length > 0 || visibleRooms.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Current room card */}
      {currentRoom && (
        <div className="p-4 border-b">
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Swords className="h-4 w-4 text-primary shrink-0" />
                <span className="font-semibold text-sm truncate">{currentRoom.room_name}</span>
                {currentRoom.password_protected && roomPassword && (
                  <button
                    type="button"
                    title="Copy table password"
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

            <div className="py-3">
              <OpenTableSeats
                players={currentRoom.players}
                maxPlayers={currentRoom.max_players}
                showSeatLabels
                openFormat={isOpenFormat}
                youUsername={username}
                removableBots={isController ? mySpawnedBots : []}
                onRemoveBot={onRemoveBot}
                centerContent={
                  <span className="flex flex-col items-center gap-0.5">
                    <span className="text-[11px] font-semibold text-foreground/85">
                      {readyCount}/{currentRoom.players.length} ready
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {canStart ? "Ready to start" : "Waiting…"}
                    </span>
                  </span>
                }
              />
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isOpenFormat && (
                <Button size="sm" variant="outline" className="gap-1" onClick={onOpenDeckDialog}>
                  <Shield className="h-3 w-3" /> Select Deck
                </Button>
              )}
              {isController &&
                !isOpenFormat &&
                currentRoom.players.length < currentRoom.max_players &&
                onAddBot && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={onAddBot}>
                    <Bot className="h-3 w-3" /> Add Bot
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
      {!inRoom && hasTables && (
        <div className="px-4 pt-1 pb-1 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search tables"
              placeholder="Search tables…"
              className="h-8 pl-8 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
            />
          </div>
        </div>
      )}

      {/* Room list */}
      <ScrollArea className="flex-1">
        <div className="px-4 pb-4 pt-2">
          {!hasVisibleTables ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-20">🎮</div>
              <p className="text-sm text-muted-foreground">
                {hasTables
                  ? "No tables match your search"
                  : inRoom
                    ? "No other tables right now"
                    : "No tables available"}
              </p>
              {!hasTables && !inRoom && (
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Create a new table to start playing
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <HostedTablesSection
                roomGroups={visibleHostedRoomGroups}
                joiningRoomId={joiningRoomId}
                onJoin={requestHostedJoin}
              />

              {visibleRooms.length > 0 && (
                <section className="space-y-2">
                  <div className="flex items-end justify-between gap-2">
                    <div className="space-y-0.5">
                      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Table2 aria-hidden="true" className="h-3.5 w-3.5" />
                        Open Tables
                      </h2>
                      <p className="text-[11px] text-muted-foreground/70">
                        Pick a table and take a seat
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {visibleRooms.length} {visibleRooms.length === 1 ? "table" : "tables"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),22rem))] justify-start gap-3">
                    {visibleRooms.map((room) => (
                      <OpenTableCard
                        key={room.room_id}
                        room={room}
                        currentRoomId={currentRoom?.room_id ?? null}
                        joining={joiningRoomId === room.room_id}
                        onJoin={requestJoin}
                      />
                    ))}
                  </div>
                </section>
              )}
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
        onClose={() => {
          setFormatRoom(null);
          setHostedFormatRooms(null);
        }}
        onSelect={(room, format) => {
          if (formatAfterJoin) {
            onSetFormat?.(format);
          } else if (hostedFormatRooms) {
            void handleJoinHostedRooms(hostedFormatRooms, format);
          } else {
            void handleJoinRoom(room.room_id, undefined, format);
          }
        }}
      />
    </div>
  );
}
