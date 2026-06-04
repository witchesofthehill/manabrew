import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hand, Users, Swords, Shield, LogOut, Bot, X, ChevronDown } from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import type { GameFormat, RoomInfo } from "@/types/server";
import { cn } from "@/lib/utils";

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

interface TablesListProps {
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  username: string | null;
  onNewGame: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshDisabled: boolean;
  onJoinRoom: (roomId: string) => Promise<void>;
  onLeaveRoom: () => void;
  onSetReady: (ready: boolean) => void;
  onSetFormat?: (format: GameFormat) => void;
  onOpenDeckDialog: () => void;
  onStartGame: () => void;
  onStartTabletop?: () => void;
  onStartDraft?: () => void;
  onStartSealed?: () => void;
  startingLimited?: boolean;
  onAddBot?: () => void;
  onRemoveBot?: (username: string) => void;
  /** Bots this host process spawned — used to show the remove button. The
   *  relay has no isBot field; tracking lives client-local. */
  mySpawnedBots?: string[];
}

export function TablesList({
  rooms,
  currentRoom,
  username,
  onJoinRoom,
  onLeaveRoom,
  onSetReady,
  onSetFormat,
  onOpenDeckDialog,
  onStartGame,
  onStartTabletop,
  onStartDraft,
  onStartSealed,
  startingLimited = false,
  onAddBot,
  onRemoveBot,
  mySpawnedBots = [],
}: TablesListProps) {
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const inRoom = currentRoom != null;
  const myPlayer = currentRoom?.players.find((p) => p.username === username);
  const myPlayerHasDeck = !!myPlayer?.selected_deck_name;
  // The controller is the first seated player — they drive the lobby (format,
  // bots, start) even when the host is a non-playing engine node. In a normal
  // self-created room the host is the first player, so the two coincide.
  const isController = currentRoom?.players[0]?.username === username;
  const isLimitedRoom = !!(currentRoom?.draft_config || currentRoom?.sealed_config);
  const isOpenFormat = currentRoom?.format === "Any" || isLimitedRoom;
  const minReady = isOpenFormat ? 1 : 2;
  const allReady = currentRoom
    ? currentRoom.players.length >= minReady && currentRoom.players.every((p) => p.ready)
    : false;
  const readyDisabled = !isOpenFormat && !myPlayerHasDeck;

  const orderedPlayers = currentRoom
    ? [...currentRoom.players].sort((a, b) => {
        if (a.username === currentRoom.host) return -1;
        if (b.username === currentRoom.host) return 1;
        return a.username.localeCompare(b.username);
      })
    : [];

  async function handleJoinRoom(roomId: string) {
    if (joiningRoomId) return;
    setJoiningRoomId(roomId);
    try {
      await onJoinRoom(roomId);
    } finally {
      setJoiningRoomId(null);
    }
  }

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
                return (
                  <div
                    key={p.username}
                    className={cn(
                      "rounded-lg border px-3 py-2 flex items-center gap-2.5 transition-colors",
                      p.ready ? "border-primary/30 bg-primary/5" : "bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        p.ready ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{p.username}</span>
                        {p.username === currentRoom.host && (
                          <GameIcon
                            name="overlord-helm"
                            className="h-3 w-3 text-commander shrink-0"
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {isOpenFormat
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
                          p.ready &&
                            "bg-primary border-primary text-primary-foreground hover:bg-primary",
                        )}
                      >
                        {p.ready ? "Ready" : "Waiting"}
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
                    className="rounded-lg border border-dashed px-3 py-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
                    onClick={onAddBot}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Add Bot
                  </button>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              {!isOpenFormat && (
                <Button size="sm" variant="outline" className="gap-1" onClick={onOpenDeckDialog}>
                  <Shield className="h-3 w-3" /> Select Deck
                </Button>
              )}
              {myPlayer && !myPlayer.ready ? (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => onSetReady(true)}
                  disabled={readyDisabled}
                >
                  Ready Up
                </Button>
              ) : myPlayer?.ready ? (
                <Button size="sm" variant="outline" onClick={() => onSetReady(false)}>
                  Unready
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={onLeaveRoom}
              >
                <LogOut className="h-3 w-3" /> Leave
              </Button>
              {isController && (
                <div className="ml-auto flex items-center gap-2">
                  {onStartTabletop && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={onStartTabletop}
                      disabled={!allReady}
                    >
                      <Hand className="h-3 w-3" /> Tabletop
                    </Button>
                  )}
                  {onStartDraft && isOpenFormat && currentRoom.draft_config && (
                    <Button
                      size="sm"
                      className="gap-1"
                      onClick={onStartDraft}
                      disabled={!allReady || startingLimited}
                      title={!allReady ? "All players must be ready" : undefined}
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
                      disabled={!allReady || startingLimited}
                      title={!allReady ? "All players must be ready" : undefined}
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
                      disabled={!allReady}
                    >
                      <Swords className="h-3 w-3" /> Start Game
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room list */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-20">🎮</div>
              <p className="text-sm text-muted-foreground">No rooms available</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Create a new room to start playing
              </p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rooms
                .filter((room) => room.status === "Lobby" || room.room_id === currentRoom?.room_id)
                .map((room) => {
                  const isMyRoom = room.room_id === currentRoom?.room_id;
                  const canJoin =
                    !inRoom && room.status === "Lobby" && room.players.length < room.max_players;
                  const isFull = room.players.length >= room.max_players;

                  return (
                    <div
                      key={room.room_id}
                      className={cn(
                        "rounded-lg border p-3 transition-colors",
                        isMyRoom && "border-primary/40 bg-primary/5",
                        !isMyRoom &&
                          canJoin &&
                          "hover:border-primary/30 hover:bg-muted/20 cursor-pointer",
                      )}
                      onClick={() => {
                        if (canJoin) void handleJoinRoom(room.room_id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{room.room_name}</div>
                          <div className="text-[11px] text-muted-foreground">by {room.host}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {room.hosted && (
                            <Badge variant="secondary" className="text-[10px]">
                              ManaBrew
                            </Badge>
                          )}
                          {room.draft_config && (
                            <Badge variant="secondary" className="text-[10px] uppercase">
                              {room.draft_config.cube_name ?? room.draft_config.set_code}
                            </Badge>
                          )}
                          {room.sealed_config && (
                            <Badge variant="secondary" className="text-[10px] uppercase">
                              {room.sealed_config.set_code}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {room.engine === "Java" ? "Forge" : "Rust"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {room.format}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          <span>
                            {room.players.length}/{room.max_players}
                          </span>
                          <Badge
                            variant={room.status === "Lobby" ? "outline" : "secondary"}
                            className="text-[9px] ml-1"
                          >
                            {room.status === "InGame" ? "In Game" : room.status}
                          </Badge>
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
                              void handleJoinRoom(room.room_id);
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
    </div>
  );
}
