import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

interface Message {
  id: string;
  sender: string;
  content: string;
  timestamp: Date;
  type: "system" | "user" | "whisper";
}

interface ChatComponentProps {
  channelId: string;
}
//
export function ChatComponent({ channelId }: ChatComponentProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "System",
      content: "Welcome to Manabrew!",
      timestamp: new Date(),
      type: "system",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    const newMessage: Message = {
      id: Date.now().toString(),
      sender: "You",
      content: input,
      timestamp: new Date(),
      type: "user",
    };
    setMessages([...messages, newMessage]);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {channelId} Chat
        </span>
        <span className="text-[10px] text-muted-foreground/50 bg-muted px-1.5 py-0.5 rounded-full">
          {messages.length}
        </span>
      </div>
      <ScrollArea className="flex-1 px-3 py-2">
        <div className="space-y-1.5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "text-xs rounded px-2 py-1",
                msg.type === "system" && "text-muted-foreground italic bg-muted/30",
                msg.type === "user" && "bg-transparent",
                msg.type === "whisper" && "text-primary/80 bg-primary/5",
              )}
            >
              <span className="font-semibold mr-1.5">{stripUsernameTag(msg.sender)}</span>
              <span className="text-foreground/80">{msg.content}</span>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <div className="p-2 border-t flex gap-1.5">
        <Input
          className="h-8 text-xs pointer-coarse:h-10 pointer-coarse:text-base"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
