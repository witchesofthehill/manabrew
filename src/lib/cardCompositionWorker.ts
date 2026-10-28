import { composeCardRaster, disposeCardComposition } from "@/lib/cardComposition";
import type { CardCompositionInput, CardCompositionResult } from "@/lib/cardComposition";
import { resolveCardGlintAsset, ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import { loadCanvasImages } from "card-glint/magic/presentation";
import { decodeCanvasImage } from "card-glint/canvas";

interface WorkerStats {
  artworkBytes: number;
  activeArtworkBytes: number;
  decodedArtwork: number;
  scratchBytes: number;
  peakScratchBytes: number;
  scratchCanvases: number;
}
export type CardWorkerRequest =
  | { type: "compose"; id: number; input: CardCompositionInput }
  | { type: "cancel"; id: number }
  | { type: "asset"; id: number; data?: ArrayBuffer; contentType?: string; error?: string }
  | { type: "images"; id: number; images?: [string, ImageBitmap][]; error?: string };
export type CardWorkerResponse =
  | { type: "ready"; supported: boolean }
  | { type: "result"; id: number; result: CardCompositionResult; stats: WorkerStats }
  | { type: "error"; id: number; message: string; name: string; stats: WorkerStats }
  | { type: "asset"; id: number; url: string }
  | { type: "images"; id: number; url: string; artwork: boolean; blob?: Blob }
  | { type: "cancelAsset"; id: number };

interface PendingComposition {
  resolve(result: CardCompositionResult): void;
  reject(error: unknown): void;
  detach(): void;
  cancelled: boolean;
}
interface WorkerSlot {
  worker?: Worker;
  ready?: Promise<boolean>;
  rejectReady?: (error: unknown) => void;
  readonly pending: Map<number, PendingComposition>;
  readonly assets: Map<number, AbortController>;
  starting: number;
  stats: WorkerStats;
}

const EMPTY_WORKER_STATS: WorkerStats = {
  artworkBytes: 0,
  activeArtworkBytes: 0,
  decodedArtwork: 0,
  scratchBytes: 0,
  peakScratchBytes: 0,
  scratchCanvases: 0,
};
export const CARD_WORKER_COUNT = Math.max(
  1,
  Math.min(3, (globalThis.navigator?.hardwareConcurrency || 2) - 1),
);
const slots: WorkerSlot[] = Array.from({ length: CARD_WORKER_COUNT }, () => ({
  pending: new Map(),
  assets: new Map(),
  starting: 0,
  stats: EMPTY_WORKER_STATS,
}));
let sequence = 0;
let mainWork: Promise<unknown> = Promise.resolve();
let mainPending = 0;
const stats = {
  workerCompositions: 0,
  workerTransfers: 0,
  workerTransferBytes: 0,
  workerAssetBitmapTransfers: 0,
  workerAssetBitmapBytes: 0,
  hostAssetDecodes: 0,
  mainThreadCompositions: 0,
};

export function cardWorkerStats() {
  const sum = (field: keyof WorkerStats) =>
    slots.reduce((total, slot) => total + slot.stats[field], 0);
  return {
    ...stats,
    workerArtworkBytes: sum("artworkBytes"),
    workerActiveArtworkBytes: sum("activeArtworkBytes"),
    workerDecodedArtwork: sum("decodedArtwork"),
    workerScratchBytes: sum("scratchBytes"),
    workerPeakScratchBytes: sum("peakScratchBytes"),
    workerScratchCanvases: sum("scratchCanvases"),
    workerPending: slots.reduce((total, slot) => total + slot.pending.size, 0),
    mainThreadPending: mainPending,
    workerStarted: slots.filter((slot) => slot.worker).length,
  };
}

function failSlot(slot: WorkerSlot, error: unknown): void {
  for (const job of slot.pending.values()) {
    job.detach();
    job.reject(error);
  }
  slot.pending.clear();
  for (const controller of slot.assets.values()) controller.abort(error);
  slot.assets.clear();
  slot.stats = EMPTY_WORKER_STATS;
}

export function terminateCardRenderWorker(): void {
  const error = new DOMException("Card rendering worker terminated", "AbortError");
  for (const slot of slots) {
    slot.worker?.terminate();
    slot.worker = undefined;
    slot.ready = undefined;
    slot.rejectReady?.(error);
    slot.rejectReady = undefined;
    failSlot(slot, error);
  }
}

function startWorker(slot: WorkerSlot): Promise<boolean> {
  if (slot.ready) return slot.ready;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined" ||
    typeof FontFace === "undefined"
  )
    return Promise.resolve(false);
  const { pending, assets } = slot;
  slot.ready = new Promise<boolean>((resolve, reject) => {
    slot.rejectReady = reject;
    const instance = new Worker(new URL("../workers/cardRender.worker.ts", import.meta.url), {
      type: "module",
      name: "card-render",
    });
    slot.worker = instance;
    window.addEventListener("pagehide", terminateCardRenderWorker, { once: true });
    instance.onerror = (event) => {
      if (slot.worker !== instance) return;
      const error = new Error(event.message || "Card rendering worker failed");
      reject(error);
      slot.rejectReady = undefined;
      instance.terminate();
      failSlot(slot, error);
      slot.worker = undefined;
      slot.ready = undefined;
    };
    instance.onmessage = (event: MessageEvent<CardWorkerResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        resolve(message.supported);
        slot.rejectReady = undefined;
        if (!message.supported) {
          instance.terminate();
          if (slot.worker === instance) slot.worker = undefined;
        }
      } else if (message.type === "asset") {
        const controller = new AbortController();
        assets.set(message.id, controller);
        void resolveCardGlintAsset(message.url, { signal: controller.signal })
          .then(async (response) => {
            const data = await response.arrayBuffer();
            if (!controller.signal.aborted && slot.worker === instance)
              instance.postMessage(
                {
                  type: "asset",
                  id: message.id,
                  data,
                  contentType: response.headers.get("content-type") ?? undefined,
                } satisfies CardWorkerRequest,
                [data],
              );
          })
          .catch((error: unknown) => {
            if (slot.worker === instance)
              instance.postMessage({
                type: "asset",
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              } satisfies CardWorkerRequest);
          })
          .finally(() => {
            if (assets.get(message.id) === controller) assets.delete(message.id);
          });
      } else if (message.type === "images") {
        const controller = new AbortController();
        assets.set(message.id, controller);
        void (async () => {
          let disposeImages: (() => void) | undefined;
          const owned: ImageBitmap[] = [];
          let transferred = false;
          try {
            const images: [string, ImageBitmap][] = [];
            if (message.artwork) {
              const blob =
                message.blob ??
                (await (
                  await resolveCardGlintAsset(message.url, { signal: controller.signal })
                ).blob());
              const bitmap = await decodeCanvasImage(blob, controller.signal);
              owned.push(bitmap);
              images.push([message.url, bitmap]);
            } else {
              await ensureCardGlintFonts();
              controller.signal.throwIfAborted();
              const lease = await loadCanvasImages([message.url], controller.signal);
              disposeImages = lease.dispose;
              if (!lease.images.get(message.url))
                throw new Error(`Card image could not be decoded: ${message.url}`);
              for (const [url, image] of lease.images) {
                if (!owned.includes(image)) owned.push(image);
                images.push([url, image]);
              }
            }
            controller.signal.throwIfAborted();
            if (slot.worker !== instance) return;
            const bytes = owned.reduce((sum, image) => sum + image.width * image.height * 4, 0);
            instance.postMessage(
              { type: "images", id: message.id, images } satisfies CardWorkerRequest,
              owned,
            );
            transferred = true;
            stats.workerAssetBitmapTransfers += owned.length;
            stats.workerAssetBitmapBytes += bytes;
            stats.hostAssetDecodes++;
          } catch (error) {
            if (slot.worker === instance)
              instance.postMessage({
                type: "images",
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
              } satisfies CardWorkerRequest);
          } finally {
            if (disposeImages) disposeImages();
            else if (!transferred) for (const bitmap of owned) bitmap.close();
            if (assets.get(message.id) === controller) assets.delete(message.id);
          }
        })();
      } else if (message.type === "cancelAsset") {
        assets.get(message.id)?.abort();
      } else {
        slot.stats = message.stats;
        const job = pending.get(message.id);
        pending.delete(message.id);
        job?.detach();
        if (message.type === "result") {
          stats.workerTransfers++;
          stats.workerTransferBytes +=
            (message.result.raster.width * message.result.raster.height +
              (message.result.printing
                ? message.result.printing.width * message.result.printing.height
                : 0) +
              (message.result.highlights?.regions.reduce(
                (sum, region) =>
                  sum +
                  region.ink.width * region.ink.height +
                  region.paper.width * region.paper.height,
                0,
              ) ?? 0)) *
            4;
          if (!job || job.cancelled) disposeCardComposition(message.result);
          else job.resolve(message.result);
        } else if (job && !job.cancelled) {
          const error = new Error(message.message);
          error.name = message.name;
          job.reject(error);
        }
      }
    };
  });
  return slot.ready;
}

export async function composeCardOffThread(
  input: CardCompositionInput,
  signal: AbortSignal,
): Promise<CardCompositionResult> {
  const load = (slot: WorkerSlot) => slot.pending.size + slot.starting;
  const slot = slots.reduce((best, candidate) => (load(candidate) < load(best) ? candidate : best));
  slot.starting++;
  let supported: boolean;
  try {
    supported = await startWorker(slot);
  } finally {
    slot.starting--;
  }
  signal.throwIfAborted();
  if (!supported) {
    if (mainPending >= 128) throw new Error("Card fallback queue is full");
    mainPending++;
    const result = mainWork.then(async () => {
      signal.throwIfAborted();
      stats.mainThreadCompositions++;
      return composeCardRaster(input, signal);
    });
    mainWork = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      mainPending--;
    });
  }
  const instance = slot.worker;
  if (!instance) throw new Error("Card rendering worker is unavailable after initialization");
  const { pending } = slot;
  if (pending.size >= 128) throw new Error("Card worker queue is full");
  const id = ++sequence;
  stats.workerCompositions++;
  return new Promise<CardCompositionResult>((resolve, reject) => {
    const abort = () => {
      job.cancelled = true;
      reject(signal.reason);
      instance.postMessage({ type: "cancel", id } satisfies CardWorkerRequest);
    };
    const job: PendingComposition = {
      resolve,
      reject,
      cancelled: false,
      detach: () => signal.removeEventListener("abort", abort),
    };
    pending.set(id, job);
    signal.addEventListener("abort", abort, { once: true });
    instance.postMessage({ type: "compose", id, input } satisfies CardWorkerRequest);
  });
}
