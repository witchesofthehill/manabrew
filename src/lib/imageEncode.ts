const WEBP_MIME = "image/webp";
const QUALITY_LADDER = [0.85, 0.7, 0.55, 0.4];
const SHRINK_STEPS = 2;
const SHRINK_FACTOR = 0.75;

export interface NormalizeImageOptions {
  maxPx: number;
  maxBytes: number;
}

export const AVATAR_IMAGE_BUDGET: NormalizeImageOptions = { maxPx: 512, maxBytes: 256 * 1024 };
export const PLAYMAT_IMAGE_BUDGET: NormalizeImageOptions = {
  maxPx: 4096,
  maxBytes: 3 * 1024 * 1024,
};

export class ImageTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Image could not be compressed under ${Math.round(maxBytes / 1024)} KB`);
    this.name = "ImageTooLargeError";
  }
}

export async function normalizeToWebp(
  source: Blob,
  { maxPx, maxBytes }: NormalizeImageOptions,
): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    let scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    for (let step = 0; step <= SHRINK_STEPS; step++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) throw new Error("2d canvas context unavailable");
      ctx.drawImage(bitmap, 0, 0, width, height);
      for (const quality of QUALITY_LADDER) {
        const blob = await canvasToWebp(canvas, quality);
        if (blob.type !== WEBP_MIME) throw new Error("WebP encoding unsupported");
        if (blob.size <= maxBytes) return await blobToDataUrl(blob);
      }
      scale *= SHRINK_FACTOR;
    }
    throw new ImageTooLargeError(maxBytes);
  } finally {
    bitmap.close();
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToWebp(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: WEBP_MIME, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
      WEBP_MIME,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}
