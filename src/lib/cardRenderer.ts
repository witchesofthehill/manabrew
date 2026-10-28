import type { ScryfallLanguage } from "@/i18n/locales";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { getTheme } from "@/hooks/useTheme";
import { captureCardInput, prepareCard } from "@/lib/cardRenderSnapshot";
import type { CardRenderRequest, PreparedCard } from "@/lib/cardRenderSnapshot";
import { attachCardRenderGeometry } from "@/lib/cardRenderGeometry";
import { CardRenderError } from "@/lib/cardRenderDecision";
import type { CardRenderDecision } from "@/lib/cardRenderDecision";
import { cardGlintFace } from "@/lib/cardRenderFace";
import type { CardGlintFace } from "@/lib/cardRenderFace";
import { enqueueCardRender, cardQueueStats, resetCardQueueStats } from "@/lib/cardRenderQueue";
import type { CardRenderPriority } from "@/lib/cardRenderQueue";
import {
  CARD_RENDER_TIERS,
  CARD_RENDER_TIER_WIDTH,
  cardRasterStats,
  ownCardRaster,
  releaseCardRaster,
  retainCardRaster,
} from "@/lib/cardRenderTypes";
import type { CardRaster, CardRenderTier } from "@/lib/cardRenderTypes";
import { registerCardOpticalSource } from "@/lib/cardOpticalLayers";
import {
  disposeCardLiveHighlights,
  getCardLiveHighlights,
  setCardLiveHighlights,
} from "@/lib/cardLiveHighlights";
import {
  composeCardOffThread,
  cardWorkerStats,
  terminateCardRenderWorker,
} from "@/lib/cardCompositionWorker";
import { disposeCardComposition } from "@/lib/cardComposition";
import { cardArtworkStats, clearCardArtworkCache } from "@/lib/cardRenderArtwork";
import type { CardSemanticPalette } from "@/lib/cardSemanticLayout";
import { cardScratchStats } from "@/lib/cardRasterScratch";
import {
  cardFaceStoreStats,
  clearStoredCardFaces,
  readStoredCardFace,
  resetCardFaceStoreStats,
  storeCardFace,
} from "@/lib/cardFaceStore";

export type { CardRenderRequest } from "@/lib/cardRenderSnapshot";

export function cardRenderInputKey(request: CardRenderRequest): string {
  return JSON.stringify(captureCardInput(request));
}

export interface CardRenderOptions {
  rulesText?: boolean;
  priority?: CardRenderPriority;
  standardFrameFallback?: boolean;
  tier?: CardRenderTier;
}

const MAX_FINISHED_CARDS = 1024;
const MAX_FINISHED_BYTES = 256 * 1024 * 1024;
const finished = new Map<string, { raster: CardRaster; bytes: number; release(): void }>();
const decisions = new WeakMap<CardRaster, CardRenderDecision>();
const restoring = new Map<string, Promise<void>>();
const compositions = new WeakMap<
  PreparedCard,
  CardGlintFace & {
    optionsKey: string;
    faceKey: string;
    key: string;
    palette: CardSemanticPalette;
  }
>();
let finishedBytes = 0;
let preparing = 0;
const counters = {
  requests: 0,
  cacheHits: 0,
  failures: 0,
  evictions: 0,
  tableCompositions: 0,
  nativeCompositions: 0,
  inspectCompositions: 0,
  resizes: 0,
};

export function getCardRenderDecision(raster: CardRaster): CardRenderDecision | undefined {
  return decisions.get(raster);
}

export function getCardRenderStats() {
  const cachedSources = new Set([...finished.values()].map(({ raster }) => raster));
  return {
    ...counters,
    ...cardQueueStats(),
    ...cardRasterStats(cachedSources),
    ...cardWorkerStats(),
    ...cardArtworkStats(),
    ...cardScratchStats(),
    ...cardFaceStoreStats(),
    preparing,
    finishedCards: finished.size,
    finishedBytes,
  };
}

export function clearCardRenderCache(): boolean {
  const { active, queued } = cardQueueStats();
  if (active || queued || preparing) return false;
  for (const entry of finished.values()) entry.release();
  finished.clear();
  finishedBytes = 0;
  for (const key of Object.keys(counters) as (keyof typeof counters)[]) counters[key] = 0;
  resetCardQueueStats();
  resetCardFaceStoreStats();
  clearStoredCardFaces();
  clearCardArtworkCache();
  terminateCardRenderWorker();
  return true;
}

function cacheFinished(
  key: string,
  raster: CardRaster,
  bytes: number,
  release: () => void,
): boolean {
  if (bytes > MAX_FINISHED_BYTES) return false;
  while (finished.size >= MAX_FINISHED_CARDS || finishedBytes + bytes > MAX_FINISHED_BYTES) {
    const oldest = finished.entries().next().value;
    if (!oldest) break;
    finishedBytes -= oldest[1].bytes;
    finished.delete(oldest[0]);
    oldest[1].release();
    counters.evictions++;
  }
  finished.set(key, { raster, bytes, release });
  finishedBytes += bytes;
  return true;
}

function takeFinished(key: string): CardRaster | undefined {
  const cached = finished.get(key);
  if (!cached) return undefined;
  counters.cacheHits++;
  finished.delete(key);
  finished.set(key, cached);
  retainCardRaster(cached.raster);
  return cached.raster;
}

function tierKey(faceKey: string, tier: CardRenderTier): string {
  return JSON.stringify([faceKey, tier]);
}

function takeLargerFinished(faceKey: string, tier: CardRenderTier): CardRaster | undefined {
  for (const candidate of CARD_RENDER_TIERS.slice(CARD_RENDER_TIERS.indexOf(tier) + 1)) {
    const raster = takeFinished(tierKey(faceKey, candidate));
    if (raster) return raster;
  }
  return undefined;
}

function resizeRaster(source: CardRaster, tier: CardRenderTier): Promise<ImageBitmap> {
  const width = CARD_RENDER_TIER_WIDTH[tier];
  return createImageBitmap(source, {
    resizeWidth: width,
    resizeHeight: Math.round((source.height * width) / source.width),
    resizeQuality: "high",
  });
}

async function restoredRaster(
  faceKey: string,
  key: string,
  tier: CardRenderTier,
): Promise<ImageBitmap | undefined> {
  const larger = CARD_RENDER_TIERS.slice(CARD_RENDER_TIERS.indexOf(tier) + 1);
  for (const candidate of larger) {
    const source = finished.get(tierKey(faceKey, candidate))?.raster;
    if (!source || getCardLiveHighlights(source)) continue;
    const release = retainCardRaster(source);
    try {
      const resized = await resizeRaster(source, tier);
      counters.resizes++;
      return resized;
    } finally {
      release();
    }
  }
  const stored = await readStoredCardFace(key);
  if (stored) return stored;
  for (const candidate of larger) {
    const source = await readStoredCardFace(tierKey(faceKey, candidate));
    if (!source) continue;
    try {
      const resized = await resizeRaster(source, tier);
      counters.resizes++;
      storeCardFace(key, resized);
      return resized;
    } finally {
      source.close();
    }
  }
  return undefined;
}

async function restoreFinished(
  prepared: PreparedCard,
  composition: NonNullable<ReturnType<typeof compositions.get>>,
  rulesText: boolean,
  tier: CardRenderTier,
): Promise<void> {
  const { face, decision, faceKey, key, palette } = composition;
  const raster = await restoredRaster(faceKey, key, tier);
  if (!raster) return;
  if (finished.has(key)) {
    raster.close();
    return;
  }
  attachCardRenderGeometry(raster, face, prepared.faceIndex);
  registerCardOpticalSource(raster, face, prepared.artUrls, rulesText, tier, palette);
  decisions.set(raster, decision);
  const bytes = raster.width * raster.height * 4;
  ownCardRaster(raster, bytes);
  if (!cacheFinished(key, raster, bytes, () => releaseCardRaster(raster)))
    releaseCardRaster(raster);
}

function composeCard(
  prepared: PreparedCard,
  rulesText: boolean,
  priority: CardRenderPriority,
  standardFrameFallback: boolean,
  tier: CardRenderTier,
  signal?: AbortSignal,
): Promise<CardRaster> {
  const { cardChange, cardPrinting } = getTheme().gameTheme;
  const optionsKey = JSON.stringify([
    rulesText,
    standardFrameFallback,
    tier,
    cardChange,
    cardPrinting,
  ]);
  let composition = compositions.get(prepared);
  if (!composition || composition.optionsKey !== optionsKey) {
    const { face: resolved, decision } = cardGlintFace(prepared, standardFrameFallback);
    const face = structuredClone(resolved);
    const palette = Object.freeze({ ink: cardPrinting.ink, footer: cardPrinting.footer });
    const faceKey = JSON.stringify([
      prepared.locale,
      prepared.printing.map((printing) => printing.id),
      face,
      decision,
      rulesText,
      palette,
    ]);
    composition = { optionsKey, faceKey, key: tierKey(faceKey, tier), face, decision, palette };
    compositions.set(prepared, composition);
  }
  const cached = takeFinished(composition.key) ?? takeLargerFinished(composition.faceKey, tier);
  if (cached) return Promise.resolve(cached);
  const restoringKey = composition.key;
  let restore = restoring.get(restoringKey);
  if (!restore) {
    restore = restoreFinished(prepared, composition, rulesText, tier)
      .catch(() => undefined)
      .finally(() => restoring.delete(restoringKey));
    restoring.set(restoringKey, restore);
  }
  const { face, decision, key, palette } = composition;
  return restore.then(
    () =>
      takeFinished(key) ??
      enqueueCardRender(
        key,
        async (compositionSignal) => {
          try {
            counters[`${tier}Compositions`]++;
            const result = await composeCardOffThread(
              {
                key,
                face,
                palette,
                tier,
                rulesText,
                printingId: prepared.printing[prepared.faceIndex]?.id ?? null,
                artUrls: prepared.artUrls,
              },
              compositionSignal,
            );
            if (compositionSignal.aborted || result.key !== key) {
              disposeCardComposition(result);
              compositionSignal.throwIfAborted();
              throw new DOMException("Card composition was superseded", "AbortError");
            }
            const raster = result.raster;
            try {
              attachCardRenderGeometry(raster, face, prepared.faceIndex);
              registerCardOpticalSource(raster, face, prepared.artUrls, rulesText, tier, palette);
              decisions.set(raster, decision);
              setCardLiveHighlights(raster, result.highlights);
            } catch (error) {
              disposeCardComposition(result);
              throw error;
            }
            const highlightPixels =
              result.highlights?.regions.reduce(
                (total, region) =>
                  total +
                  region.ink.width * region.ink.height +
                  region.paper.width * region.paper.height,
                0,
              ) ?? 0;
            const bytes = (raster.width * raster.height + highlightPixels) * 4;
            ownCardRaster(raster, bytes, () => disposeCardLiveHighlights(result.highlights));
            const release = retainCardRaster(raster);
            if (!cacheFinished(key, raster, bytes, release)) release();
            if (!result.highlights) storeCardFace(key, raster);
            return raster;
          } catch (cause) {
            if (
              compositionSignal.aborted ||
              cause instanceof CardRenderError ||
              (cause instanceof Error && cause.name === "AbortError")
            )
              throw cause;
            throw new CardRenderError(
              { ...decision, mode: "original", reason: "composition-failed" },
              "Card Glint could not compose this face",
              { cause },
            );
          }
        },
        priority,
        signal,
      ),
  );
}

export async function renderCard(
  request: CardRenderRequest,
  signal?: AbortSignal,
  {
    rulesText = true,
    priority = "visible",
    standardFrameFallback = false,
    tier = "native",
  }: CardRenderOptions = {},
): Promise<CardRaster> {
  signal?.throwIfAborted();
  counters.requests++;
  preparing++;
  let pending: Promise<CardRaster>;
  let locale: ScryfallLanguage;
  try {
    const input = captureCardInput(request);
    locale = input.locale;
    const prepared = await prepareCard(input);
    signal?.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale)
      throw new DOMException("Card language changed during preparation", "AbortError");
    pending = composeCard(prepared, rulesText, priority, standardFrameFallback, tier, signal);
  } catch (error) {
    if (!signal?.aborted) counters.failures++;
    throw error;
  } finally {
    preparing--;
  }
  let raster: CardRaster | undefined;
  try {
    raster = await pending;
    signal?.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale)
      throw new DOMException("Card language changed during rendering", "AbortError");
    return raster;
  } catch (error) {
    if (raster) releaseCardRaster(raster);
    if (!signal?.aborted) counters.failures++;
    throw error;
  }
}

export function renderRulesCard(
  request: CardRenderRequest,
  signal?: AbortSignal,
  options: Pick<CardRenderOptions, "tier" | "priority"> = {},
): Promise<CardRaster> {
  return renderCard(request, signal, {
    rulesText: false,
    priority: "preview",
    standardFrameFallback: true,
    ...options,
  });
}
