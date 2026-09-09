import { useEffect } from "react";
import { stopSoundCuePlayback } from "@/lib/soundCues";
import { applySoundPreferences } from "@/lib/soundRuntime";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function useSoundPreferencesRuntime(): void {
  const soundMuted = usePreferencesStore((state) => state.soundMuted);
  const soundVolume = usePreferencesStore((state) => state.soundVolume);

  useEffect(() => {
    applySoundPreferences(soundMuted, soundVolume);
    if (soundMuted) stopSoundCuePlayback();
  }, [soundMuted, soundVolume]);
}
