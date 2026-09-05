import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChatStore, type ChatEntry } from "@/stores/useChatStore";
import { CHAT_MESSAGE_MAX_CHARS, type ChatScope, type RoomInfo } from "@/types/server";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

interface ChatPanelProps {
  currentRoom: RoomInfo | null;
  currentUsername: string | null;
  disabled?: boolean;
  className?: string;
}

const SCOPE_LABEL: Record<ChatScope, string> = { Room: "Table", Lobby: "Lobby" };

function formatTime(sentAtMs: number): string {
  return new Date(sentAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPanel({
  currentRoom,
  currentUsername,
  disabled = false,
  className,
}: ChatPanelProps) {
  const lobby = useChatStore((s) => s.lobby);
  const room = useChatStore((s) => s.room);
  const unread = useChatStore((s) => s.unread);
  const send = useChatStore((s) => s.send);
  const markRead = useChatStore((s) => s.markRead);
  const inRoom = currentRoom != null;
  const [scope, setScope] = useState<ChatScope>(inRoom ? "Room" : "Lobby");
  const [prevInRoom, setPrevInRoom] = useState(inRoom);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  if (inRoom !== prevInRoom) {
    setPrevInRoom(inRoom);
    setScope(inRoom ? "Room" : "Lobby");
  }

  const entries: ChatEntry[] = scope === "Room" ? room : lobby;

  useEffect(() => {
    markRead(scope);
  }, [scope, entries.length, markRead]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries.length, scope]);

  async function handleSend() {
    const text = input.trim();
    if (!text || disabled) return;
    setInput("");
    await send(scope, text);
  }

  function renderTab(tab: ChatScope) {
    const count = unread[tab];
    return (
      <button
        key={tab}
        type="button"
        onClick={() => setScope(tab)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide",
          scope === tab
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {SCOPE_LABEL[tab]}
        {count > 0 && tab !== scope && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        {inRoom ? (
          <>
            {renderTab("Room")}
            {renderTab("Lobby")}
          </>
        ) : (
          <span className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lobby chat
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3 py-2">
        <div className="space-y-1">
          {entries.length === 0 && (
            <p className="py-4 text-center text-xs italic text-muted-foreground">
              {scope === "Room" ? "Say hello to your table." : "No messages yet."}
            </p>
          )}
          {entries.map((entry) => {
            if (entry.system) {
              return (
                <p key={entry.id} className="text-xs italic text-muted-foreground">
                  {entry.text}
                </p>
              );
            }
            const mine = entry.from === currentUsername;
            return (
              <div key={entry.id} className="text-xs leading-snug">
                <span className="mr-1 text-[10px] text-muted-foreground/70">
                  {formatTime(entry.sentAtMs)}
                </span>
                <span className={cn("mr-1.5 font-semibold", mine && "text-primary")}>
                  {stripUsernameTag(entry.from)}
                </span>
                <span className="break-words text-foreground/85">{entry.text}</span>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </ScrollArea>
      <form
        className="flex shrink-0 gap-1.5 border-t p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        <Input
          className="h-8 text-xs pointer-coarse:h-10 pointer-coarse:text-base"
          placeholder={scope === "Room" ? "Message your table…" : "Message the lobby…"}
          value={input}
          maxLength={CHAT_MESSAGE_MAX_CHARS}
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
        />
        <Button
          type="submit"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled || !input.trim()}
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
