import type { IMediaInstance, Sound } from "@pixi/sound";

import { loadSoundAsset, logSoundPlayback } from "@/lib/soundRuntime";
import type { DisplayEvent } from "@/protocol/display";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import {
  DISPLAY_EVENT_AUDIO_ASSETS,
  DISPLAY_EVENT_AUDIO,
  type DisplayEventAudioAssetKey,
  type DisplayEventAudioDefinition,
} from "./displayEventAudioCatalog";

interface PendingCue {
  definition: DisplayEventAudioDefinition;
  generation: number;
}

interface PlaybackCue extends PendingCue {
  assetKey: DisplayEventAudioAssetKey;
}

interface ActivePlayback {
  token: symbol;
  instance: IMediaInstance | null;
}

const DISPLAY_AUDIO_BURST_IDLE_MS = 50;

const loadedAssets = new Map<DisplayEventAudioAssetKey, Sound>();
const pendingBurst = new Map<string, PendingCue>();
const cueQueue: PlaybackCue[] = [];
const variantOffsets = new Map<string, number>();
const seenPromptEvents = new Set<string>();
let playbackQueue = Promise.resolve();
let burstFlushTimer: number | null = null;
let activePlayback: ActivePlayback | null = null;
let sessionGeneration = 0;

function finishPlayback(token: symbol): void {
  if (activePlayback?.token !== token) return;
  activePlayback = null;
  playNextCue();
}

function playNextCue(): void {
  if (activePlayback) return;

  while (cueQueue.length > 0) {
    const cue = cueQueue.shift();
    if (!cue || cue.generation !== sessionGeneration || usePreferencesStore.getState().soundMuted) {
      continue;
    }

    const soundAsset = loadedAssets.get(cue.assetKey);
    if (!soundAsset) continue;

    const token = Symbol();
    activePlayback = { token, instance: null };
    try {
      const playback = soundAsset.play({ volume: cue.definition.volume });
      if (!playback) {
        activePlayback = null;
        continue;
      }

      void Promise.resolve(playback)
        .then((instance) => {
          if (activePlayback?.token !== token) {
            instance.stop();
            return;
          }
          activePlayback.instance = instance;
          logSoundPlayback(DISPLAY_EVENT_AUDIO_ASSETS[cue.assetKey].src);
          instance.once("end", () => finishPlayback(token));
          instance.once("stop", () => finishPlayback(token));
        })
        .catch(() => finishPlayback(token));
      return;
    } catch {
      activePlayback = null;
    }
  }
}

async function loadCue(voiceKey: string, pending: PendingCue): Promise<PlaybackCue | null> {
  const variants = (
    await Promise.all(
      pending.definition.variants.map(async (key) => {
        const loaded = loadedAssets.get(key);
        if (loaded) return key;
        const soundAsset = await loadSoundAsset(DISPLAY_EVENT_AUDIO_ASSETS[key]);
        if (!soundAsset) return null;
        loadedAssets.set(key, soundAsset);
        return key;
      }),
    )
  ).filter((key): key is DisplayEventAudioAssetKey => key !== null);
  if (
    pending.generation !== sessionGeneration ||
    usePreferencesStore.getState().soundMuted ||
    variants.length === 0
  ) {
    return null;
  }

  const initialOffset = variantOffsets.get(voiceKey) ?? 0;
  variantOffsets.set(voiceKey, initialOffset + 1);
  return {
    ...pending,
    assetKey: variants[initialOffset % variants.length],
  };
}

async function enqueueBurst(batch: Array<[string, PendingCue]>): Promise<void> {
  const cues = (await Promise.all(batch.map(([key, cue]) => loadCue(key, cue)))).filter(
    (cue): cue is PlaybackCue => cue !== null,
  );
  cueQueue.push(...cues);
  playNextCue();
}

function flushBurst(): void {
  window.clearTimeout(burstFlushTimer ?? undefined);
  burstFlushTimer = null;
  if (pendingBurst.size === 0) return;

  const batch = [...pendingBurst.entries()];
  pendingBurst.clear();
  playbackQueue = playbackQueue.then(() => enqueueBurst(batch)).catch(() => undefined);
}

function scheduleBurstFlush(): void {
  window.clearTimeout(burstFlushTimer ?? undefined);
  burstFlushTimer = window.setTimeout(flushBurst, DISPLAY_AUDIO_BURST_IDLE_MS);
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

  const voiceKey = definition.variants.join("\u0000");
  pendingBurst.set(voiceKey, { definition, generation: sessionGeneration });
  if (event.eventType.startsWith("prompt.") || event.eventType.startsWith("game.outcome.")) {
    flushBurst();
  } else {
    scheduleBurstFlush();
  }
}

export function stopDisplayEventAudio(): void {
  sessionGeneration += 1;
  window.clearTimeout(burstFlushTimer ?? undefined);
  burstFlushTimer = null;
  pendingBurst.clear();
  cueQueue.length = 0;
  const active = activePlayback;
  activePlayback = null;
  active?.instance?.stop();
  for (const soundAsset of loadedAssets.values()) {
    soundAsset.stop();
  }
  playbackQueue = Promise.resolve();
}

export function resetDisplayEventAudioSession(): void {
  stopDisplayEventAudio();
  variantOffsets.clear();
  seenPromptEvents.clear();
}
