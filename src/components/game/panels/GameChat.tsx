import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatPanel } from "@/components/lobby/ChatPanel";
import { useChatStore } from "@/stores/useChatStore";
import { useServerStore } from "@/stores/useServerStore";
import { RELAY_FEATURE } from "@/types/server";

export function GameChat() {
  const [open, setOpen] = useState(false);
  const currentRoom = useServerStore((s) => s.currentRoom);
  const username = useServerStore((s) => s.username);
  const connected = useServerStore((s) => s.connected);
  const chatEnabled = useServerStore((s) => s.hasRelayFeature(RELAY_FEATURE.Chat));
  const unread = useChatStore((s) => s.unread.Room + s.unread.Lobby);

  if (!currentRoom || !chatEnabled) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="absolute bottom-[calc(7rem+var(--safe-area-inset-bottom))] left-[calc(0.75rem+var(--safe-area-inset-left))] z-50 shadow-sm"
        >
          <MessageSquare className="h-4 w-4" />
          Chat
          {unread > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-ui-meta text-primary-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Chat</SheetTitle>
          <SheetDescription>
            Chat is monitored. Keep it respectful—the banhammer is ready.
          </SheetDescription>
        </SheetHeader>
        <ChatPanel
          key={currentRoom.room_id}
          currentRoom={currentRoom}
          currentUsername={username}
          disabled={!connected}
          className="min-h-0 flex-1"
        />
      </SheetContent>
    </Sheet>
  );
}
