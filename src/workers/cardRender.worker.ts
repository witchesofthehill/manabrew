import { composeCardRaster, disposeCardComposition } from "@/lib/cardComposition";
import type { CardCompositionResult } from "@/lib/cardComposition";
import type { CardWorkerRequest, CardWorkerResponse } from "@/lib/cardCompositionWorker";
import { setCardGlintAssetResolver } from "@/lib/cardGlintAssets";
import { cardArtworkStats, setCardImageBridge } from "@/lib/cardRenderArtwork";
import { cardScratchStats } from "@/lib/cardRasterScratch";
import { initializeKernels } from "card-glint/kernels";
import pixelsWasmUrl from "card-glint/pixels.wasm?url";

interface CardWorkerRealm {
  fonts?: FontFaceSet;
  postMessage(message: CardWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CardWorkerRequest>) => void,
  ): void;
}
const realm = globalThis as unknown as CardWorkerRealm;
const controllers = new Map<number, AbortController>();
const assets = new Map<
  number,
  { resolve(response: Response): void; reject(error: unknown): void; detach(): void }
>();
const pendingImages = new Map<
  number,
  {
    resolve(images: Map<string, ImageBitmap>): void;
    reject(error: unknown): void;
    detach(): void;
  }
>();
let sequence = 0;
let work = Promise.resolve();
let kernels: Promise<void> | undefined;

setCardGlintAssetResolver((url, options = {}) => {
  const id = ++sequence;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      assets.delete(id);
      realm.postMessage({ type: "cancelAsset", id });
      reject(options.signal?.reason);
    };
    assets.set(id, {
      resolve,
      reject,
      detach: () => options.signal?.removeEventListener("abort", abort),
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    realm.postMessage({ type: "asset", id, url });
  });
});

setCardImageBridge((url, artwork, signal, blob) => {
  signal.throwIfAborted();
  const id = ++sequence;
  return new Promise<Map<string, ImageBitmap>>((resolve, reject) => {
    const abort = () => {
      pendingImages.delete(id);
      realm.postMessage({ type: "cancelAsset", id });
      reject(signal.reason);
    };
    pendingImages.set(id, {
      resolve,
      reject,
      detach: () => signal.removeEventListener("abort", abort),
    });
    signal.addEventListener("abort", abort, { once: true });
    realm.postMessage({ type: "images", id, url, artwork, blob });
  });
});

function transfers(result: CardCompositionResult): Transferable[] {
  const images = [
    result.raster,
    result.printing,
    ...(result.highlights?.regions.flatMap(({ ink, paper }) => [ink, paper]) ?? []),
  ];
  return images.filter((image): image is ImageBitmap => image instanceof ImageBitmap);
}

realm.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "asset") {
    const pending = assets.get(message.id);
    if (!pending) return;
    assets.delete(message.id);
    pending.detach();
    if (message.error) pending.reject(new Error(message.error));
    else
      pending.resolve(
        new Response(message.data, {
          headers: message.contentType ? { "Content-Type": message.contentType } : undefined,
        }),
      );
  } else if (message.type === "images") {
    const pending = pendingImages.get(message.id);
    pendingImages.delete(message.id);
    pending?.detach();
    if (!pending) {
      for (const bitmap of new Set(message.images?.map(([, bitmap]) => bitmap))) bitmap.close();
    } else if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(new Map(message.images));
    }
  } else if (message.type === "cancel") {
    controllers.get(message.id)?.abort(new DOMException("Card rendering cancelled", "AbortError"));
  } else {
    const controller = new AbortController();
    controllers.set(message.id, controller);
    work = work.then(async () => {
      let result: CardCompositionResult | undefined;
      try {
        controller.signal.throwIfAborted();
        await (kernels ??= initializeKernels({ wasmUrl: pixelsWasmUrl }).catch((error: unknown) => {
          kernels = undefined;
          throw error;
        }));
        controller.signal.throwIfAborted();
        result = await composeCardRaster(message.input, controller.signal);
        controller.signal.throwIfAborted();
        realm.postMessage(
          {
            type: "result",
            id: message.id,
            result,
            stats: { ...cardArtworkStats(), ...cardScratchStats() },
          },
          transfers(result),
        );
        result = undefined;
      } catch (error) {
        if (result) disposeCardComposition(result);
        realm.postMessage({
          type: "error",
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : "Error",
          stats: { ...cardArtworkStats(), ...cardScratchStats() },
        });
      } finally {
        controllers.delete(message.id);
      }
    });
  }
});

let supported =
  typeof OffscreenCanvas !== "undefined" &&
  typeof createImageBitmap === "function" &&
  typeof FontFace === "function" &&
  Boolean(realm.fonts);
if (supported) {
  const canvas = new OffscreenCanvas(1, 1);
  supported =
    Boolean(canvas.getContext("2d")) && typeof canvas.transferToImageBitmap === "function";
  canvas.width = canvas.height = 0;
}
realm.postMessage({ type: "ready", supported });
