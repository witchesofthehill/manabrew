import type { MseCanvas, MseFields, MseSession } from "@mse-renderer";
import type * as MseRuntime from "@mse-renderer";
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

export { getMseCardRules, MSE_CARD_WIDTH, MSE_CARD_HEIGHT } from "@/lib/mseCardArtwork";
export type { MseCardArtwork } from "@/lib/mseCardArtwork";
export type { MseCardRequest } from "@/lib/mseCardSnapshot";

interface MseEnvironment {
  runtime: typeof MseRuntime;
  session: MseSession;
}

export interface MseCardRenderOptions {
  rulesText?: boolean;
}

const MAX_FINISHED_CARDS = 128;
const MAX_FINISHED_BYTES = 96 * 1024 * 1024;
const finished = new Map<string, MseCanvas>();
const pendingCards = new Map<string, Promise<MseCanvas>>();
const pendingRenders = new Map<string, Promise<MseCanvas>>();
let finishedBytes = 0;
let environment: Promise<MseEnvironment> | undefined;
let compositionTail: Promise<void> = Promise.resolve();

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

function composeCard(
  prepared: PreparedMseCard,
  { runtime, session }: MseEnvironment,
  rulesText: boolean,
): Promise<MseCanvas> {
  const presentation = runtime.selectMsePresentation(prepared.snapshot, {
    faceIndex: prepared.faceIndex,
    availableStyles: session.styles,
  });
  const style = presentation.style;
  if (!style) return Promise.reject(new Error("No MSE template is available for this card"));
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
    finished.delete(key);
    finished.set(key, cached);
    return Promise.resolve(cached);
  }
  const existing = pendingRenders.get(key);
  if (existing) return existing;
  const task = compositionTail
    .then(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
      const bytes = canvas.width * canvas.height * 4;
      if (bytes <= MAX_FINISHED_BYTES) {
        while (finished.size >= MAX_FINISHED_CARDS || finishedBytes + bytes > MAX_FINISHED_BYTES) {
          const oldest = finished.entries().next().value;
          if (!oldest) break;
          finishedBytes -= oldest[1].width * oldest[1].height * 4;
          finished.delete(oldest[0]);
        }
        finished.set(key, canvas);
        finishedBytes += bytes;
      }
      return canvas;
    })
    .finally(() => pendingRenders.delete(key));
  compositionTail = task.then(
    () => undefined,
    () => undefined,
  );
  pendingRenders.set(key, task);
  return task;
}

function waitForConsumer(pending: Promise<MseCanvas>, signal?: AbortSignal): Promise<MseCanvas> {
  if (!signal) return pending;
  if (signal.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Card rendering cancelled", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Card rendering cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (canvas) => {
        signal.removeEventListener("abort", abort);
        resolve(canvas);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function renderMseCard(
  request: MseCardRequest,
  signal?: AbortSignal,
  { rulesText = true }: MseCardRenderOptions = {},
): Promise<MseCanvas> {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason ?? new DOMException("Card rendering cancelled", "AbortError"),
    );
  try {
    const input = captureMseCardInput(request);
    const key = JSON.stringify([input, rulesText]);
    let pending = pendingCards.get(key);
    if (!pending) {
      pending = Promise.all([prepareMseCard(input), import("@mse-renderer")])
        .then(async ([prepared, runtime]) => {
          if (
            !runtime.selectMsePresentation(prepared.snapshot, { faceIndex: prepared.faceIndex })
              .style
          ) {
            throw new Error("No MSE template supports this card layout and printing");
          }
          return composeCard(prepared, await getEnvironment(), rulesText);
        })
        .then((canvas) => {
          if (useScryfallStore.getState().locale !== input.locale) {
            throw new DOMException("Card language changed during rendering", "AbortError");
          }
          return canvas;
        })
        .finally(() => pendingCards.delete(key));
      pendingCards.set(key, pending);
    }
    return waitForConsumer(pending, signal);
  } catch (error) {
    return Promise.reject(error);
  }
}
