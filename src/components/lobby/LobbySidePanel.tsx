import { ChatPanel } from "@/components/lobby/ChatPanel";
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
  onJoinRoom: (roomId: string, password?: string) => Promise<void>;
  onInvite: (username: string) => Promise<void>;
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
  onJoinRoom,
  onInvite,
}: LobbySidePanelProps) {
  const roster = (
    <UserList
      players={players}
      rooms={rooms}
      currentRoom={currentRoom}
      currentPlayerId={currentPlayerId}
      currentUsername={currentUsername}
      connectionState={connectionState}
      onJoinRoom={onJoinRoom}
      onInvite={invitesEnabled ? onInvite : undefined}
    />
  );

  if (!chatEnabled) return roster;

  return (
    <ResizablePanelGroup orientation="vertical">
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
  );
}
