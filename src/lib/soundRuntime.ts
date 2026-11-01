import { sound, type Sound } from "@pixi/sound";
import { Assets } from "pixi.js";

import { usePreferencesStore } from "@/stores/usePreferencesStore";

interface SoundDefinition {
  alias: string;
  src: string;
  volume: number;
  cooldownMs: number;
}

function soundDefinition(name: string, volume: number, cooldownMs = 0): SoundDefinition {
  return { alias: `sound.${name}`, src: `/sounds/${name}.wav`, volume, cooldownMs };
}

const SOUNDS = {
  chatMessage: soundDefinition("chat", 0.55, 250),
  buttonClick: soundDefinition("button-click2", 0.3, 50),
  roomInvite: soundDefinition("invite", 0.75, 1_000),
  cardPlay: soundDefinition("card-play", 0.6),
  cardEnter: soundDefinition("card-etb", 0.5),
  cardTap: soundDefinition("", 0),
  cardUntap: soundDefinition("", 0),
  cardAttach: soundDefinition("", 0),
  cardTransform: soundDefinition("", 0),
  tokenCreate: soundDefinition("", 0),
  cardDiscard: soundDefinition("discard", 0.4),
  cardDestroy: soundDefinition("grave", 0.2),
  cardExile: soundDefinition("exile", 0.4),
  cardCounterAdd: soundDefinition("", 0),
  cardCounterRemove: soundDefinition("", 0),
  cardDamage: soundDefinition("resolvespell", 0.4),
  instantResolve: soundDefinition("", 0),
  sorceryResolve: soundDefinition("", 0),
  lifeGain: soundDefinition("", 0),
  lifeLoss: soundDefinition("resolvespell", 0.4),
  combatBlock: soundDefinition("", 0),
  outcomeWin: soundDefinition("", 0),
  outcomeLoss: soundDefinition("", 0),
  priority: soundDefinition("", 0),
};

export type SoundName = keyof typeof SOUNDS;

const loadedAssets = new Map<string, Sound>();
const assetLoads = new Map<string, Promise<Sound | null>>();
const lastPlayedAt = new Map<SoundName, number>();
const SOUND_WINDOW_MS = 30;
let pendingSoundTimer: ReturnType<typeof setTimeout> | undefined;
let playbackGeneration = 0;

function loadSoundAsset(asset: SoundDefinition): Promise<Sound | null> {
  const loaded = loadedAssets.get(asset.alias);
  if (loaded) return Promise.resolve(loaded);

  const pending = assetLoads.get(asset.alias);
  if (pending) return pending;

  const load = Assets.load<Sound>({ alias: asset.alias, src: asset.src })
    .then((soundAsset) => {
      loadedAssets.set(asset.alias, soundAsset);
      return soundAsset;
    })
    .catch(() => {
      assetLoads.delete(asset.alias);
      return null;
    });
  assetLoads.set(asset.alias, load);
  return load;
}

function logSoundPlayback(src: string, reason: string): void {
  if (!import.meta.env.DEV) return;
  console.info(`[sound] ${reason} — played ${src.slice(src.lastIndexOf("/") + 1)}`);
}

export function applySoundPreferences(soundMuted: boolean, soundVolume: number): void {
  sound.volumeAll = soundVolume;
  if (sound.supported) sound.disableAutoPause = true;
  if (!soundMuted) {
    sound.unmuteAll();
    sound.resumeAll();
    return;
  }

  playbackGeneration += 1;
  clearTimeout(pendingSoundTimer);
  pendingSoundTimer = undefined;
  lastPlayedAt.clear();
  sound.muteAll();
  sound.stopAll();
}

export function playSound(...names: SoundName[]): void {
  if (usePreferencesStore.getState().soundMuted) return;

  const now = performance.now();
  let name: SoundName | undefined;
  for (let index = names.length - 1; index >= 0; index -= 1) {
    const candidate = names[index];
    const definition = SOUNDS[candidate];
    if (definition.volume <= 0) continue;
    const previousPlay = lastPlayedAt.get(candidate);
    if (previousPlay !== undefined && now - previousPlay < definition.cooldownMs) continue;
    name = candidate;
    break;
  }
  if (!name) return;

  const definition = SOUNDS[name];
  lastPlayedAt.set(name, now);

  clearTimeout(pendingSoundTimer);
  const generation = ++playbackGeneration;
  pendingSoundTimer = setTimeout(() => {
    pendingSoundTimer = undefined;
    if (usePreferencesStore.getState().soundMuted) return;

    void loadSoundAsset(definition).then((soundAsset) => {
      if (
        !soundAsset ||
        generation !== playbackGeneration ||
        usePreferencesStore.getState().soundMuted
      ) {
        return;
      }

      try {
        const playback = soundAsset.play({ volume: definition.volume });
        void Promise.resolve(playback)
          .then(() => logSoundPlayback(definition.src, name))
          .catch(() => undefined);
      } catch {
        return;
      }
    });
  }, SOUND_WINDOW_MS);
}
