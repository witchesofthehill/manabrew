import { CheckCircle2, Loader2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { useServerStore } from "@/stores/useServerStore";
interface ReconnectBannerProps {
  className?: string;
}
export function ReconnectBanner({ className }: ReconnectBannerProps) {
  const reconnect = useServerStore((s) => s.reconnect);
  const gameView = useGameStore((s) => s.gameView);
  const currentPrompt = useGameStore((s) => s.currentPrompt);
  const myPlayerSlot = useGameStore((s) => s.myPlayerSlot);
  const previousPhase = useRef(reconnect.phase);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const previous = previousPhase.current;
    previousPhase.current = reconnect.phase;
    let timer = 0;
    let frame = 0;
    if (previous === "reconnecting" && reconnect.phase === "idle") {
      frame = window.requestAnimationFrame(() => {
        setRestored(true);
        timer = window.setTimeout(() => setRestored(false), 3200);
      });
    } else if (reconnect.phase !== "idle") {
      frame = window.requestAnimationFrame(() => setRestored(false));
    }
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [reconnect.phase]);
  if (reconnect.phase === "idle" && !restored) return null;
  const activePlayer = gameView?.players.find((player) => player.id === gameView.activePlayerId);
  const context =
    currentPrompt && gameView?.priorityPlayerId === myPlayerSlot
      ? `Your ${currentPrompt.input.type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} decision is ready.`
      : activePlayer
        ? `${activePlayer.id === myPlayerSlot ? "Your" : `${activePlayer.name}'s`} turn is restored.`
        : "Game state restored.";
  const message =
    reconnect.phase === "failed"
      ? "Connection could not be restored."
      : reconnect.phase === "reconnecting"
        ? reconnect.reason === "server-shutdown"
          ? "Server updating, reconnecting…"
          : `Reconnecting… (attempt ${reconnect.attempt})`
        : context;
  const Icon =
    reconnect.phase === "reconnecting"
      ? Loader2
      : reconnect.phase === "failed"
        ? WifiOff
        : CheckCircle2;
  return (
    <div
      role="status"
      className={cn(
        "absolute left-1/2 top-[calc(0.5rem+var(--safe-area-inset-top))] z-[9000] flex min-h-11 max-w-[min(90vw,36rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-card/95 px-4 py-2 text-xs font-semibold text-foreground shadow-xl backdrop-blur-sm",
        reconnect.phase === "failed" ? "border-destructive/50" : "border-border/80",
        className,
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          reconnect.phase === "reconnecting" && "motion-safe:animate-spin",
          reconnect.phase === "failed" ? "text-destructive" : "text-primary",
        )}
      />
      <span className="truncate">{message}</span>
    </div>
  );
}
