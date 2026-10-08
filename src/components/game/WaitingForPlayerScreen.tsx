import { Loader2 } from "lucide-react";
interface WaitingForPlayerScreenProps {
  reason: "self" | "opponent";
  secondsLeft: number | null;
  disconnectedNames: string[];
}
export function WaitingForPlayerScreen({
  reason,
  secondsLeft,
  disconnectedNames,
}: WaitingForPlayerScreenProps) {
  const heading = reason === "self" ? "Connection lost" : "Waiting for player…";
  const detail =
    reason === "self"
      ? "Reconnecting to the game…"
      : disconnectedNames.length > 0
        ? `${disconnectedNames.join(", ")} disconnected. Waiting for them to reconnect…`
        : "An opponent disconnected. Waiting for them to reconnect…";
  const subtext =
    reason === "self"
      ? "Your choices are paused. We’ll restore the current turn and prompt automatically."
      : "The game will continue from the same turn and prompt after they reconnect.";
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90 p-4 text-center [padding-bottom:max(1rem,var(--safe-area-inset-bottom))] [padding-left:max(1rem,var(--safe-area-inset-left))] [padding-right:max(1rem,var(--safe-area-inset-right))] [padding-top:max(1rem,var(--safe-area-inset-top))]">
      <Loader2 className="h-10 w-10 animate-spin text-warning motion-reduce:animate-none" />
      <h2 className="text-2xl font-bold">{heading}</h2>
      <p className="max-w-xl text-muted-foreground">{detail}</p>
      <p className="max-w-xl text-sm text-muted-foreground">{subtext}</p>
      {secondsLeft !== null && (
        <p className="text-sm text-muted-foreground">
          Game will be aborted in <span className="font-semibold text-warning">{secondsLeft}s</span>
        </p>
      )}
    </div>
  );
}
