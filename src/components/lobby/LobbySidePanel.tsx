import { useState } from "react";
import { MessageSquare, Users } from "lucide-react";
import { ChatPanel } from "@/components/lobby/ChatPanel";
import { RoomInviteOverlay } from "@/components/lobby/RoomInviteOverlay";
import { useChatStore } from "@/stores/useChatStore";
import { cn } from "@/lib/utils";
import { UserList, type ConnectionState } from "@/components/lobby/UserList";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import type { PlayerInfo, RoomInfo } from "@/types/server";

interface LobbySidePanelProps {
  players: PlayerInfo[];
  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  currentPlayerId: string | null;
  currentUsername: string | null;
  connectionState: ConnectionState;
  chatEnabled: boolean;
  invitesEnabled: boolean;
  layout?: "split" | "tabs";
  onJoinRoom: (roomId: string, password?: string) => Promise<void>;
}

export function LobbySidePanel({
  players,
  rooms,
  currentRoom,
  currentPlayerId,
  currentUsername,
  connectionState,
  chatEnabled,
  invitesEnabled,
  layout = "split",
  onJoinRoom,
}: LobbySidePanelProps) {
  const [tab, setTab] = useState<"players" | "chat">("players");
  const unread = useChatStore((s) => s.unread.Lobby + s.unread.Room);
  const roster = (
    <UserList
      players={players}
      rooms={rooms}
      currentRoom={currentRoom}
      currentPlayerId={currentPlayerId}
      currentUsername={currentUsername}
      connectionState={connectionState}
      onJoinRoom={onJoinRoom}
      invitesEnabled={invitesEnabled}
    />
  );

  const invites = <RoomInviteOverlay inline />;

  if (!chatEnabled) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {invites}
        <div className="min-h-0 flex-1">{roster}</div>
      </div>
    );
  }

  if (layout === "tabs") {
    const chat = (
      <ChatPanel
        currentRoom={currentRoom}
        currentUsername={currentUsername}
        disabled={connectionState !== "connected"}
        className="h-full"
      />
    );
    const renderTab = (key: "players" | "chat", label: string, Icon: typeof Users) => (
      <button
        type="button"
        onClick={() => setTab(key)}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium",
          tab === key
            ? "border-primary text-foreground"
            : "border-transparent text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        {label}
        {key === "chat" && unread > 0 && tab !== "chat" && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
            {unread}
          </span>
        )}
      </button>
    );
    return (
      <div className="flex h-full min-h-0 flex-col">
        {invites}
        <div className="flex shrink-0 border-b">
          {renderTab("players", "Players", Users)}
          {renderTab("chat", "Chat", MessageSquare)}
        </div>
        <div className="min-h-0 flex-1">{tab === "players" ? roster : chat}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {invites}
      <ResizablePanelGroup orientation="vertical" resizeTargetMinimumSize={{ coarse: 24, fine: 6 }}>
        <ResizablePanel defaultSize={50} minSize="10rem">
          {roster}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className="h-px w-full after:inset-x-0 after:inset-y-auto after:top-1/2 after:h-2 after:w-full after:-translate-y-1/2 after:translate-x-0 [&>div]:rotate-90"
        />
        <ResizablePanel defaultSize={50} minSize="16rem">
          <ChatPanel
            currentRoom={currentRoom}
            currentUsername={currentUsername}
            disabled={connectionState !== "connected"}
            className="h-full"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
