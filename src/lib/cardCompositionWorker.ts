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
let worker: Worker | undefined;
let ready: Promise<boolean> | undefined;
let rejectReady: ((error: unknown) => void) | undefined;
let sequence = 0;
let mainWork: Promise<unknown> = Promise.resolve();
let mainPending = 0;
const pending = new Map<number, PendingComposition>();
const assets = new Map<number, AbortController>();
const stats = {
  workerCompositions: 0,
  workerTransfers: 0,
  workerTransferBytes: 0,
  workerAssetBitmapTransfers: 0,
  workerAssetBitmapBytes: 0,
  hostAssetDecodes: 0,
  workerArtworkBytes: 0,
  workerActiveArtworkBytes: 0,
  workerDecodedArtwork: 0,
  workerScratchBytes: 0,
  workerPeakScratchBytes: 0,
  workerScratchCanvases: 0,
  mainThreadCompositions: 0,
};

export function cardWorkerStats() {
  return {
    ...stats,
    workerPending: pending.size,
    mainThreadPending: mainPending,
    workerStarted: Boolean(worker),
  };
}
function updateStats(next: WorkerStats): void {
  stats.workerArtworkBytes = next.artworkBytes;
  stats.workerActiveArtworkBytes = next.activeArtworkBytes;
  stats.workerDecodedArtwork = next.decodedArtwork;
  stats.workerScratchBytes = next.scratchBytes;
  stats.workerPeakScratchBytes = next.peakScratchBytes;
  stats.workerScratchCanvases = next.scratchCanvases;
}

export function terminateCardRenderWorker(): void {
  worker?.terminate();
  worker = undefined;
  ready = undefined;
  const error = new DOMException("Card rendering worker terminated", "AbortError");
  rejectReady?.(error);
  rejectReady = undefined;
  for (const job of pending.values()) {
    job.detach();
    job.reject(error);
  }
  pending.clear();
  for (const controller of assets.values()) controller.abort(error);
  assets.clear();
  updateStats({
    artworkBytes: 0,
    activeArtworkBytes: 0,
    decodedArtwork: 0,
    scratchBytes: 0,
    peakScratchBytes: 0,
    scratchCanvases: 0,
  });
}

function startWorker(): Promise<boolean> {
  if (ready) return ready;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined" ||
    typeof FontFace === "undefined"
  )
    return Promise.resolve(false);
  ready = new Promise<boolean>((resolve, reject) => {
    rejectReady = reject;
    const instance = new Worker(new URL("../workers/cardRender.worker.ts", import.meta.url), {
      type: "module",
      name: "card-render",
    });
    worker = instance;
    window.addEventListener("pagehide", terminateCardRenderWorker, { once: true });
    instance.onerror = (event) => {
      if (worker !== instance) return;
      const error = new Error(event.message || "Card rendering worker failed");
      reject(error);
      rejectReady = undefined;
      for (const job of pending.values()) {
        job.detach();
        job.reject(error);
      }
      pending.clear();
      instance.terminate();
      for (const controller of assets.values()) controller.abort(error);
      assets.clear();
      worker = undefined;
      ready = undefined;
    };
    instance.onmessage = (event: MessageEvent<CardWorkerResponse>) => {
      const message = event.data;
      if (message.type === "ready") {
        resolve(message.supported);
        rejectReady = undefined;
        if (!message.supported) {
          instance.terminate();
          if (worker === instance) worker = undefined;
        }
      } else if (message.type === "asset") {
        const controller = new AbortController();
        assets.set(message.id, controller);
        void resolveCardGlintAsset(message.url, { signal: controller.signal })
          .then(async (response) => {
            const data = await response.arrayBuffer();
            if (!controller.signal.aborted && worker === instance)
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
            if (worker === instance)
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
            if (worker !== instance) return;
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
            if (worker === instance)
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
        updateStats(message.stats);
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
  return ready;
}

export async function composeCardOffThread(
  input: CardCompositionInput,
  signal: AbortSignal,
): Promise<CardCompositionResult> {
  const supported = await startWorker();
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
  if (!worker) throw new Error("Card rendering worker is unavailable after initialization");
  if (pending.size >= 128) throw new Error("Card worker queue is full");
  const instance = worker;
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
