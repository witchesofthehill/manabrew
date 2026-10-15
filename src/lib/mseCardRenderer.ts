import type { MseCanvas, MseFields, MseSession, MseRenderDecision } from "@mse-renderer";
import type * as MseRuntime from "@mse-renderer";
import type { ScryfallLanguage } from "@/i18n/locales";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { getPlatformType } from "@/platform";
import { platformFetch } from "@/lib/platformFetch";
import { scryfallAssetsMirrored, scryfallAssetUrl } from "@/lib/scryfallAssets";
import {
  captureMseCardInput,
  prepareMseCard,
  type MseCardRequest,
  type PreparedMseCard,
} from "@/lib/mseCardSnapshot";
import { createMseCanvas, loadMseCardArtwork, normalizeMseCanvas } from "@/lib/mseCardArtwork";
import { MseCardRenderError } from "@/lib/mseCardDecision";
import {
  enqueueMseRender,
  mseQueueStats,
  resetMseQueueStats,
  type MseRenderPriority,
} from "@/lib/mseRenderQueue";

export type { MseCardRequest } from "@/lib/mseCardSnapshot";

interface MseEnvironment {
  runtime: typeof MseRuntime;
  session: MseSession;
}

export interface MseCardRenderOptions {
  rulesText?: boolean;
  priority?: MseRenderPriority;
  standardFrameFallback?: boolean;
}

const MAX_FINISHED_CARDS = 128;
const MAX_FINISHED_BYTES = 96 * 1024 * 1024;
const finished = new Map<string, MseCanvas>();
const decisions = new WeakMap<MseCanvas, MseRenderDecision>();

export function getMseRenderDecision(canvas: MseCanvas): MseRenderDecision | undefined {
  return decisions.get(canvas);
}
let finishedBytes = 0;
let preparing = 0;
let environment: Promise<MseEnvironment> | undefined;
const counters = { requests: 0, cacheHits: 0, failures: 0, evictions: 0 };

export function getMseRenderStats() {
  return {
    ...counters,
    ...mseQueueStats(),
    preparing,
    finishedCards: finished.size,
    finishedBytes,
  };
}

export function clearMseRenderCache(): boolean {
  const { active, queued } = mseQueueStats();
  if (active || queued || preparing) return false;
  finished.clear();
  finishedBytes = 0;
  counters.requests = 0;
  counters.cacheHits = 0;
  counters.failures = 0;
  counters.evictions = 0;
  resetMseQueueStats();
  return true;
}

function getEnvironment(): Promise<MseEnvironment> {
  environment ??= import("@mse-renderer")
    .then(async (runtime) => ({
      runtime,
      session: await runtime.createBrowserMseSession({
        createCanvas: createMseCanvas,
        loadCardImage: loadMseCardArtwork,
        fetcher: (input, init) =>
          platformFetch(input instanceof Request ? input.url : input.toString(), init),
      }),
    }))
    .catch((error: unknown) => {
      environment = undefined;
      throw error;
    });
  return environment;
}

function selectPresentation(
  runtime: typeof MseRuntime,
  prepared: PreparedMseCard,
  standardFrameFallback: boolean,
  availableStyles?: Iterable<string>,
) {
  const options = { faceIndex: prepared.faceIndex, availableStyles };
  const presentation = runtime.selectMsePresentation(prepared.snapshot, options);
  if (
    standardFrameFallback &&
    presentation.decision.mode === "original" &&
    (presentation.decision.reason === "unsupported-treatment" ||
      presentation.decision.reason === "ambiguous-treatment")
  ) {
    return runtime.selectMsePresentation(prepared.snapshot, {
      ...options,
      printing: { frame: "2015", border_color: "black", frame_effects: [] },
    });
  }
  return presentation;
}

function composeCard(
  prepared: PreparedMseCard,
  { runtime, session }: MseEnvironment,
  rulesText: boolean,
  priority: MseRenderPriority,
  standardFrameFallback: boolean,
  signal?: AbortSignal,
): Promise<MseCanvas> {
  const presentation = selectPresentation(runtime, prepared, standardFrameFallback, session.styles);
  const style = presentation.style;
  if (!style) return Promise.reject(new MseCardRenderError(presentation.decision));
  const setFields = runtime.printingMseSetFields(prepared.snapshot);
  const setCode = prepared.snapshot.set;
  if (setCode && (scryfallAssetsMirrored || getPlatformType() === "tauri")) {
    const set = useScryfallStore.getState().sets.find((candidate) => candidate.code === setCode);
    const symbol =
      set?.icon_svg_uri ?? `https://svgs.scryfall.io/sets/${encodeURIComponent(setCode)}.svg`;
    setFields.symbol = scryfallAssetUrl(symbol);
  }
  const key = JSON.stringify([prepared, presentation, setFields, rulesText]);
  const cached = finished.get(key);
  if (cached) {
    counters.cacheHits += 1;
    finished.delete(key);
    finished.set(key, cached);
    return Promise.resolve(cached);
  }
  return enqueueMseRender(
    key,
    async () => {
      const nativeCard: MseFields = {
        ...presentation.nativeCard,
        ...runtime.printingMseCardFields(prepared.snapshot),
        ...runtime.printingMseFooterFields(prepared.snapshot),
      };
      if (prepared.combined) {
        prepared.artUrls.forEach((url, index) => {
          nativeCard[index === 0 ? "image" : `image_${index + 1}`] = url ?? "";
        });
      } else {
        nativeCard.image = prepared.artUrls[prepared.faceIndex] ?? "";
      }
      const result = await session.renderer.render(
        {
          style,
          snapshot: prepared.snapshot,
          adapter: {
            faceIndex: prepared.combined ? null : prepared.faceIndex,
            linkedFaces: prepared.snapshot.card_faces?.length === 2 && !prepared.combined,
            nativeCard,
            set: setFields,
            styling: presentation.styling,
          },
        },
        { cache: false, rulesText },
      );
      const canvas = normalizeMseCanvas(result);
      decisions.set(canvas, presentation.decision);
      const bytes = canvas.width * canvas.height * 4;
      if (bytes <= MAX_FINISHED_BYTES) {
        while (finished.size >= MAX_FINISHED_CARDS || finishedBytes + bytes > MAX_FINISHED_BYTES) {
          const oldest = finished.entries().next().value;
          if (!oldest) break;
          finishedBytes -= oldest[1].width * oldest[1].height * 4;
          finished.delete(oldest[0]);
          counters.evictions += 1;
        }
        finished.set(key, canvas);
        finishedBytes += bytes;
      }
      return canvas;
    },
    priority,
    signal,
  );
}

export async function renderMseCard(
  request: MseCardRequest,
  signal?: AbortSignal,
  {
    rulesText = true,
    priority = "visible",
    standardFrameFallback = false,
  }: MseCardRenderOptions = {},
): Promise<MseCanvas> {
  signal?.throwIfAborted();
  counters.requests += 1;
  preparing += 1;
  let pending: Promise<MseCanvas>;
  let locale: ScryfallLanguage;
  try {
    const input = captureMseCardInput(request);
    locale = input.locale;
    const [prepared, runtime] = await Promise.all([prepareMseCard(input), import("@mse-renderer")]);
    signal?.throwIfAborted();
    const presentation = selectPresentation(runtime, prepared, standardFrameFallback);
    if (!presentation.style) throw new MseCardRenderError(presentation.decision);
    const env = await getEnvironment();
    signal?.throwIfAborted();
    pending = composeCard(prepared, env, rulesText, priority, standardFrameFallback, signal);
  } catch (error) {
    if (!signal?.aborted) counters.failures += 1;
    throw error;
  } finally {
    preparing -= 1;
  }
  try {
    const canvas = await pending;
    signal?.throwIfAborted();
    if (useScryfallStore.getState().locale !== locale) {
      throw new DOMException("Card language changed during rendering", "AbortError");
    }
    return canvas;
  } catch (error) {
    if (!signal?.aborted) counters.failures += 1;
    throw error;
  }
}
