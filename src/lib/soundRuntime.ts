import { sound, type Sound } from "@pixi/sound";
import { Assets } from "pixi.js";

import { usePreferencesStore } from "@/stores/usePreferencesStore";

interface SoundAssetDefinition {
  alias: string;
  src: string;
}

const APP_SOUNDS = {
  chatMessage: {
    alias: "sound.app.chat-message",
    src: "/sounds/card-contact-soft.wav",
    volume: 0.55,
    cooldownMs: 250,
  },
  roomInvite: {
    alias: "sound.app.room-invite",
    src: "/sounds/gem-light.wav",
    volume: 0.75,
    cooldownMs: 1_000,
  },
} as const;

export type AppSound = keyof typeof APP_SOUNDS;

const loadedAssets = new Map<string, Sound>();
const assetLoads = new Map<string, Promise<Sound | null>>();
const lastPlayedAt = new Map<AppSound, number>();
let playbackGeneration = 0;

export function loadSoundAsset(asset: SoundAssetDefinition): Promise<Sound | null> {
  const loaded = loadedAssets.get(asset.alias);
  if (loaded) return Promise.resolve(loaded);

  const pending = assetLoads.get(asset.alias);
  if (pending) return pending;

  const load = Assets.load<Sound>({ alias: asset.alias, src: asset.src })
    .then((soundAsset) => {
      loadedAssets.set(asset.alias, soundAsset);
      return soundAsset;
    })
    .catch(() => null);
  assetLoads.set(asset.alias, load);
  return load;
}

export function applySoundPreferences(soundMuted: boolean, soundVolume: number): void {
  sound.volumeAll = soundVolume;
  if (!soundMuted) {
    sound.unmuteAll();
    return;
  }

  playbackGeneration += 1;
  lastPlayedAt.clear();
  sound.muteAll();
  sound.stopAll();
}

export function playAppSound(name: AppSound): void {
  if (usePreferencesStore.getState().soundMuted) return;

  const definition = APP_SOUNDS[name];
  const now = performance.now();
  const previousPlay = lastPlayedAt.get(name);
  if (previousPlay !== undefined && now - previousPlay < definition.cooldownMs) return;

  lastPlayedAt.set(name, now);
  const generation = playbackGeneration;
  void loadSoundAsset(definition).then((soundAsset) => {
    if (
      !soundAsset ||
      generation !== playbackGeneration ||
      usePreferencesStore.getState().soundMuted
    ) {
      return;
    }

    try {
      void Promise.resolve(soundAsset.play({ volume: definition.volume })).catch(() => undefined);
    } catch {
      return;
    }
  });
}
