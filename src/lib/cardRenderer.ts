import { composeCardTexture, type RenderedCardInput } from "card-glint/magic/presentation";
import { composeSemanticCardTexture, isSemanticLayout } from "@/lib/cardSemanticLayout";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import type { ScryfallLanguage } from "@/i18n/locales";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { getTheme } from "@/hooks/useTheme";
import {
  captureCardInput,
  prepareCard,
  type CardRenderRequest,
  type PreparedCard,
} from "@/lib/cardRenderSnapshot";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import { attachCardRenderGeometry } from "@/lib/cardRenderGeometry";
import { CardRenderError, type CardRenderDecision } from "@/lib/cardRenderDecision";
import { cardGlintFace, type CardGlintFace } from "@/lib/cardRenderFace";
import {
  enqueueCardRender,
  cardQueueStats,
  resetCardQueueStats,
  type CardRenderPriority,
} from "@/lib/cardRenderQueue";
import type { CardCanvas } from "@/lib/cardRenderTypes";
import { registerCardOpticalSource } from "@/lib/cardOpticalLayers";
import { getCardLiveHighlights, registerCardLiveHighlights } from "@/lib/cardLiveHighlights";

export type { CardRenderRequest } from "@/lib/cardRenderSnapshot";

export function cardRenderInputKey(request: CardRenderRequest): string {
  return JSON.stringify(captureCardInput(request));
}

export interface CardRenderOptions {
  rulesText?: boolean;
  priority?: CardRenderPriority;
  standardFrameFallback?: boolean;
}

const MAX_FINISHED_CARDS = 128;
const MAX_FINISHED_BYTES = 96 * 1024 * 1024;
const finished = new Map<string, { canvas: CardCanvas; bytes: number }>();
const decisions = new WeakMap<CardCanvas, CardRenderDecision>();
const compositions = new WeakMap<
  PreparedCard,
  CardGlintFace & { optionsKey: string; key: string }
>();
let finishedBytes = 0;
let preparing = 0;
const counters = { requests: 0, cacheHits: 0, failures: 0, evictions: 0 };

export function getCardRenderDecision(canvas: CardCanvas): CardRenderDecision | undefined {
  return decisions.get(canvas);
}

export function getCardRenderStats() {
  return {
    ...counters,
    ...cardQueueStats(),
    preparing,
    finishedCards: finished.size,
    finishedBytes,
  };
}

export function clearCardRenderCache(): boolean {
  const { active, queued } = cardQueueStats();
  if (active || queued || preparing) return false;
  finished.clear();
  finishedBytes = 0;
  counters.requests = 0;
  counters.cacheHits = 0;
  counters.failures = 0;
  counters.evictions = 0;
  resetCardQueueStats();
  return true;
}

function withoutLiveInk<T extends RenderedCardInput>(face: T, colors: Set<string>): T {
  const faces = face.faces?.map((child) => withoutLiveInk(child, colors));
  if (!face.textInk && (!faces || faces.every((child, index) => child === face.faces![index])))
    return face;
  if (face.textInk) {
    for (const spans of [face.textInk.stats, face.textInk.typeLine])
      for (const span of spans ?? []) colors.add(span.color);
  }
  return {
    ...face,
    textInk: face.textInk ? { ...face.textInk, omitInk: true } : undefined,
    faces,
  };
}

function composeCard(
  prepared: PreparedCard,
  rulesText: boolean,
  priority: CardRenderPriority,
  standardFrameFallback: boolean,
  signal?: AbortSignal,
): Promise<CardCanvas> {
  const { cardChange, cardPrinting } = getTheme().gameTheme;
  const optionsKey = JSON.stringify([rulesText, standardFrameFallback, cardChange, cardPrinting]);
  let composition = compositions.get(prepared);
  if (!composition || composition.optionsKey !== optionsKey) {
    const { face, decision } = cardGlintFace(prepared, standardFrameFallback);
    const key = JSON.stringify([
      prepared.locale,
      prepared.printing.map((printing) => printing.id),
      face,
      decision,
      rulesText,
      isSemanticLayout(face) ? cardPrinting : undefined,
    ]);
    composition = { optionsKey, key, face, decision };
    compositions.set(prepared, composition);
  }
  const { face, decision, key } = composition;
  const cached = finished.get(key);
  if (cached) {
    counters.cacheHits += 1;
    finished.delete(key);
    finished.set(key, cached);
    return Promise.resolve(cached.canvas);
  }
  return enqueueCardRender(
    key,
    async () => {
      try {
        await ensureCardGlintFonts();
        const compositionSignal = new AbortController().signal;
        const loadImages = cardImageLoader(prepared.artUrls);
        const paint = (input: typeof face) =>
          isSemanticLayout(input)
            ? composeSemanticCardTexture(input, "inspect", compositionSignal, {
                rulesText,
                loadImages,
                loadFonts: ensureCardGlintFonts,
              })
            : composeCardTexture(
                {
                  face: input,
                  printingId: prepared.printing[prepared.faceIndex]?.id ?? null,
                  printedImage: null,
                  rulesText,
                },
                "inspect",
                compositionSignal,
                { loadImages },
              );
        const canvas = await paint(face);
        attachCardRenderGeometry(canvas, face, prepared.faceIndex);
        const colors = new Set<string>();
        const backingFace = withoutLiveInk(face, colors);
        if (backingFace !== face) {
          const backing = await paint(backingFace);
          registerCardLiveHighlights(canvas, backing, [...colors]);
          backing.width = backing.height = 0;
        }
        registerCardOpticalSource(canvas, face, prepared.artUrls, rulesText);
        decisions.set(canvas, decision);
        const highlights = getCardLiveHighlights(canvas);
        const highlightPixels =
          highlights?.regions.reduce(
            (total, region) =>
              total +
              region.ink.width * region.ink.height +
              region.paper.width * region.paper.height,
            0,
          ) ?? 0;
        const bytes = (canvas.width * canvas.height + highlightPixels) * 4;
        if (bytes <= MAX_FINISHED_BYTES) {
          while (
            finished.size >= MAX_FINISHED_CARDS ||
            finishedBytes + bytes > MAX_FINISHED_BYTES
          ) {
            const oldest = finished.entries().next().value;
            if (!oldest) break;
            finishedBytes -= oldest[1].bytes;
            finished.delete(oldest[0]);
            counters.evictions += 1;
          }
          finished.set(key, { canvas, bytes });
          finishedBytes += bytes;
        }
        return canvas;
      } catch (cause) {
        if (cause instanceof CardRenderError) throw cause;
        throw new CardRenderError(
          { ...decision, mode: "original", reason: "composition-failed" },
          "Card Glint could not compose this face",
          { cause },
        );
      }
    },
    priority,
    signal,
  );
}

export async function renderCard(
  request: CardRenderRequest,
  signal?: AbortSignal,
  { rulesText = true, priority = "visible", standardFrameFallback = false }: CardRenderOptions = {},
): Promise<CardCanvas> {
  signal?.throwIfAborted();
  counters.requests += 1;
  preparing += 1;
  let pending: Promise<CardCanvas>;
  let locale: ScryfallLanguage;
  try {
    const input = captureCardInput(request);
    locale = input.locale;
    const prepared = await prepareCard(input);
    signal?.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale)
      throw new DOMException("Card language changed during preparation", "AbortError");
    pending = composeCard(prepared, rulesText, priority, standardFrameFallback, signal);
  } catch (error) {
    if (!signal?.aborted) counters.failures += 1;
    throw error;
  } finally {
    preparing -= 1;
  }
  try {
    const canvas = await pending;
    signal?.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale)
      throw new DOMException("Card language changed during rendering", "AbortError");
    return canvas;
  } catch (error) {
    if (!signal?.aborted) counters.failures += 1;
    throw error;
  }
}

export function renderRulesCard(
  request: CardRenderRequest,
  signal?: AbortSignal,
): Promise<CardCanvas> {
  return renderCard(request, signal, {
    rulesText: false,
    priority: "preview",
    standardFrameFallback: true,
  });
}
