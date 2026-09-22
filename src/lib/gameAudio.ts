import { usePreferencesStore } from "@/stores/usePreferencesStore";

export type GameAudioCue =
  | "turn"
  | "card"
  | "damage"
  | "resolve"
  | "priority"
  | "confirm"
  | "reject";

let context: AudioContext | null = null;
let unlocked = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) return null;
  context ??= new AudioContextCtor();
  return context;
}

export function installGameAudioUnlock(): () => void {
  const unlock = () => {
    const ctx = audioContext();
    if (!ctx) return;
    void ctx.resume().then(() => {
      unlocked = ctx.state === "running";
    });
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function playGameAudioCue(cue: GameAudioCue): void {
  const prefs = usePreferencesStore.getState();
  const category =
    cue === "priority" || cue === "confirm" || cue === "reject" ? "interface" : "effects";
  const volume = category === "interface" ? prefs.interfaceVolume : prefs.effectsVolume;
  if (volume <= 0 || !unlocked) return;
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;

  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const settings: Record<
    GameAudioCue,
    { from: number; to: number; duration: number; type: OscillatorType }
  > = {
    turn: { from: 330, to: 520, duration: 0.16, type: "sine" },
    card: { from: 240, to: 300, duration: 0.11, type: "triangle" },
    damage: { from: 150, to: 90, duration: 0.13, type: "sawtooth" },
    resolve: { from: 520, to: 360, duration: 0.16, type: "sine" },
    priority: { from: 660, to: 820, duration: 0.1, type: "sine" },
    confirm: { from: 520, to: 680, duration: 0.08, type: "sine" },
    reject: { from: 170, to: 120, duration: 0.12, type: "square" },
  };
  const sound = settings[cue];
  oscillator.type = sound.type;
  oscillator.frequency.setValueAtTime(sound.from, now);
  oscillator.frequency.exponentialRampToValueAtTime(sound.to, now + sound.duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.045), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + sound.duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + sound.duration + 0.01);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gain.disconnect();
  });
}
