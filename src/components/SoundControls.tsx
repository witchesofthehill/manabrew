import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
  SOUND_VOLUME_STEP,
  usePreferencesStore,
} from "@/stores/usePreferencesStore";

interface SoundControlsProps {
  className?: string;
}

export function SoundControls({ className }: SoundControlsProps) {
  const soundMuted = usePreferencesStore((state) => state.soundMuted);
  const soundVolume = usePreferencesStore((state) => state.soundVolume);
  const toggleSoundMuted = usePreferencesStore((state) => state.toggleSoundMuted);
  const setSoundVolume = usePreferencesStore((state) => state.setSoundVolume);
  const displayedVolume = soundMuted ? SOUND_VOLUME_MIN : soundVolume;
  const percentage = Math.round(displayedVolume * 100);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Button
        type="button"
        variant={soundMuted ? "default" : "outline"}
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={toggleSoundMuted}
        title={soundMuted ? "Unmute sounds" : "Mute sounds"}
        aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
        aria-pressed={soundMuted}
      >
        {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </Button>
      <input
        type="range"
        min={SOUND_VOLUME_MIN * 100}
        max={SOUND_VOLUME_MAX * 100}
        step={SOUND_VOLUME_STEP * 100}
        value={percentage}
        onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
        aria-label="Sound volume"
        className="min-w-0 flex-1 accent-primary"
      />
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {percentage}%
      </span>
    </div>
  );
}
