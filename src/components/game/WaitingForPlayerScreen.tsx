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

  const subtext = reason === "self" ? "We might be updating our servers, hang on tight 😬" : "";

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90">
      <Loader2 className="h-10 w-10 animate-spin text-warning" />
      <h2 className="text-2xl font-bold">{heading}</h2>
      <p className="text-muted-foreground">{detail}</p>
      <p className="text-muted-foreground text-sm">{subtext}</p>
      {secondsLeft !== null && (
        <p className="text-sm text-muted-foreground">
          Game will be aborted in <span className="font-semibold text-warning">{secondsLeft}s</span>
        </p>
      )}
    </div>
  );
}
