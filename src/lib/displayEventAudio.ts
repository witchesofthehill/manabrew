import type { Sound } from "@pixi/sound";

import { loadSoundAsset } from "@/lib/soundRuntime";
import type { DisplayEvent } from "@/protocol/display";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import {
  DISPLAY_EVENT_AUDIO_ASSETS,
  DISPLAY_EVENT_AUDIO,
  type DisplayEventAudioAssetKey,
  type DisplayEventAudioDefinition,
} from "./displayEventAudioCatalog";

const loadedAssets = new Map<DisplayEventAudioAssetKey, Sound>();
const activeVoices = new Map<string, number>();
const lastPlayedAt = new Map<string, number>();
const variantOffsets = new Map<string, number>();
const seenPromptEvents = new Set<string>();
let playbackQueue = Promise.resolve();
let sessionGeneration = 0;

function releaseVoice(voiceKey: string, generation: number): void {
  if (generation !== sessionGeneration) return;
  const remaining = (activeVoices.get(voiceKey) ?? 1) - 1;
  if (remaining > 0) activeVoices.set(voiceKey, remaining);
  else activeVoices.delete(voiceKey);
}
async function playDisplayEventAudio(
  event: DisplayEvent,
  definition: DisplayEventAudioDefinition,
  generation: number,
): Promise<void> {
  const variants = (
    await Promise.all(
      definition.variants.map(async (key) => {
        const loaded = loadedAssets.get(key);
        if (loaded) return key;
        const soundAsset = await loadSoundAsset(DISPLAY_EVENT_AUDIO_ASSETS[key]);
        if (!soundAsset) return null;
        loadedAssets.set(key, soundAsset);
        return key;
      }),
    )
  ).filter((key): key is DisplayEventAudioAssetKey => key !== null);
  if (generation !== sessionGeneration || usePreferencesStore.getState().soundMuted) return;
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

export function presentDisplayEventAudio(event: DisplayEvent): void {
  if (usePreferencesStore.getState().soundMuted) return;
  const definition = DISPLAY_EVENT_AUDIO[event.eventType];
  if (!definition) return;

  const promptId = event.context?.kind === "prompt" ? event.context.promptId : undefined;
  if (
    event.eventType.startsWith("prompt.") &&
    event.eventType !== "prompt.action-rejected" &&
    promptId !== undefined
  ) {
    const promptEventKey = `${event.eventType}\u0000${promptId}`;
    if (seenPromptEvents.has(promptEventKey)) return;
    seenPromptEvents.add(promptEventKey);
  }

  const generation = sessionGeneration;
  playbackQueue = playbackQueue
    .then(() => playDisplayEventAudio(event, definition, generation))
    .catch(() => undefined);
}

export function stopDisplayEventAudio(): void {
  sessionGeneration += 1;
  for (const soundAsset of loadedAssets.values()) {
    soundAsset.stop();
  }
  playbackQueue = Promise.resolve();
  activeVoices.clear();
  lastPlayedAt.clear();
}

export function resetDisplayEventAudioSession(): void {
  stopDisplayEventAudio();
  variantOffsets.clear();
  seenPromptEvents.clear();
}
