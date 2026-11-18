import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/lobby/ChatPanel";
import { useChatStore } from "@/stores/useChatStore";
import { useServerStore } from "@/stores/useServerStore";

export function GameChatButton({
  active = false,
  onClick,
}: {
  active?: boolean;
  onClick: () => void;
}) {
  const unread = useChatStore((s) => s.unread.Room + s.unread.Lobby);

  return (
    <Button
      variant={active ? "selected" : "outline"}
      size="icon"
      className="relative h-10 w-10 shrink-0 touch:min-h-11 touch:min-w-11 rounded-full shadow-lg backdrop-blur-sm"
      aria-label={unread > 0 ? `Open chat, ${unread} unread messages` : "Open chat"}
      aria-pressed={active}
      title="Open chat"
      onClick={onClick}
    >
      <MessageSquare className="h-4 w-4" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1.5 text-ui-meta text-primary-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}

export function GameChat() {
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);
  const connected = useServerStore((s) => s.connected);

  if (!currentRoom) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-ui-meta text-muted-foreground">
        Chat is monitored. Keep it respectful—the banhammer is ready.
      </p>
      <ChatPanel
        key={currentRoom.room_id}
        currentRoom={currentRoom}
        currentUsername={username}
        disabled={!connected}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
