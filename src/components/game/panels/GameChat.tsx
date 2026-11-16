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
          size="icon"
          className="relative h-10 w-10 shrink-0 touch:min-h-11 touch:min-w-11 rounded-full border-border/80 bg-card/95 shadow-lg backdrop-blur-sm"
          aria-label={unread > 0 ? `Open chat, ${unread} unread messages` : "Open chat"}
          title="Open chat"
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
      </SheetTrigger>
      <SheetContent side="right" className="z-[9002] flex flex-col">
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
