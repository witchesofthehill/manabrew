import type { Sound } from "@pixi/sound";

import { loadSoundAsset } from "@/lib/soundRuntime";
import type { DisplayEvent } from "@/protocol/display";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import {
  SOUND_ASSETS,
  SOUND_CUES,
  type SoundAssetKey,
  type SoundCueDefinition,
} from "./soundCueCatalog";

type SoundCueEvent = Extract<DisplayEvent, { kind: "soundCue" }>;

const loadedAssets = new Map<SoundAssetKey, Sound>();
const activeVoices = new Map<string, number>();
const lastPlayedAt = new Map<string, number>();
const variantOffsets = new Map<string, number>();
const seenPromptCues = new Set<string>();
let assetLoadPromise: Promise<void> | null = null;
let playbackQueue = Promise.resolve();
let lastSequence: number | null = null;
let sessionGeneration = 0;

export function initializeSoundCues(): void {
  if (assetLoadPromise) return;
  assetLoadPromise = Promise.all(
    (Object.keys(SOUND_ASSETS) as SoundAssetKey[]).map(async (key) => {
      const asset = SOUND_ASSETS[key];
      const soundAsset = await loadSoundAsset(asset);
      if (soundAsset) loadedAssets.set(key, soundAsset);
    }),
  ).then(() => undefined);
}

function releaseVoice(voiceKey: string, generation: number): void {
  if (generation !== sessionGeneration) return;
  const remaining = (activeVoices.get(voiceKey) ?? 1) - 1;
  if (remaining > 0) activeVoices.set(voiceKey, remaining);
  else activeVoices.delete(voiceKey);
}
async function playSoundCue(
  event: SoundCueEvent,
  definition: SoundCueDefinition,
  generation: number,
): Promise<void> {
  await assetLoadPromise;
  if (generation !== sessionGeneration || usePreferencesStore.getState().soundMuted) return;

  const variants = definition.variants.filter((key) => loadedAssets.has(key));
  if (variants.length === 0) return;

  const voiceKey = definition.variants.join("\u0000");
  const now = performance.now();
  const previousPlay = lastPlayedAt.get(voiceKey);
  if (previousPlay !== undefined && now - previousPlay < definition.cooldownMs) return;

  const active = activeVoices.get(voiceKey) ?? 0;
  const requested = Number.isSafeInteger(event.count) && event.count > 0 ? event.count : 1;
  const voices = Math.min(requested, Math.max(0, definition.voiceLimit - active));
  if (voices === 0) return;

  lastPlayedAt.set(voiceKey, now);
  const initialOffset = variantOffsets.get(voiceKey) ?? 0;
  variantOffsets.set(voiceKey, initialOffset + voices);
  activeVoices.set(voiceKey, active + voices);

  for (let index = 0; index < voices; index += 1) {
    const assetKey = variants[(initialOffset + index) % variants.length];
    const soundAsset = loadedAssets.get(assetKey);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseVoice(voiceKey, generation);
    };

    try {
      const playback = soundAsset?.play({ volume: definition.volume, complete: release });
      if (!playback) release();
      else void Promise.resolve(playback).catch(release);
    } catch {
      release();
    }
  }
}

export function dispatchSoundCue(event: SoundCueEvent): void {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return;
  if (lastSequence !== null && event.sequence <= lastSequence) return;
  lastSequence = event.sequence;
  if (usePreferencesStore.getState().soundMuted) return;
  const definition = SOUND_CUES[event.soundType];
  if (!definition) return;

  if (
    event.soundType.startsWith("prompt.") &&
    event.soundType !== "prompt.action-rejected" &&
    event.promptId !== undefined
  ) {
    const promptCueKey = `${event.soundType}\u0000${event.promptId}`;
    if (seenPromptCues.has(promptCueKey)) return;
    seenPromptCues.add(promptCueKey);
  }

  initializeSoundCues();
  const generation = sessionGeneration;
  playbackQueue = playbackQueue
    .then(() => playSoundCue(event, definition, generation))
    .catch(() => undefined);
}

export function stopSoundCuePlayback(): void {
  sessionGeneration += 1;
  for (const soundAsset of loadedAssets.values()) {
    soundAsset.stop();
  }
  playbackQueue = Promise.resolve();
  activeVoices.clear();
  lastPlayedAt.clear();
}

export function resetSoundCueSession(): void {
  stopSoundCuePlayback();
  lastSequence = null;
  variantOffsets.clear();
  seenPromptCues.clear();
}
