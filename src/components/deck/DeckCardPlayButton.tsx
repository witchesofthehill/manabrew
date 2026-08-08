import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeckCardPlayButtonProps {
  playing?: boolean;
  disabled?: boolean;
  onPlay: () => void;
}

export function DeckCardPlayButton({
  playing = false,
  disabled = false,
  onPlay,
}: DeckCardPlayButtonProps) {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={playing || disabled}
      className="pointer-events-auto h-8 bg-background/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
      onClick={onPlay}
    >
      {playing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
      {playing ? "Starting…" : "Play"}
    </Button>
  );
}
