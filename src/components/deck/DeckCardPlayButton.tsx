import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
      {playing ? i18n._(msg`Starting\u2026`) : i18n._(msg`Play`)}
    </Button>
  );
}
