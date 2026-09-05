import { ChatPanel } from "@/components/lobby/ChatPanel";
import { UserList, type ConnectionState } from "@/components/lobby/UserList";
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
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
      </div>
      {chatEnabled && (
        <ChatPanel
          currentRoom={currentRoom}
          currentUsername={currentUsername}
          disabled={connectionState !== "connected"}
          className="h-72 shrink-0 border-t"
        />
      )}
    </div>
  );
}
