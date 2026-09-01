export interface CropTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function coverScale(imageWidth: number, imageHeight: number, viewport: number): number {
  return viewport / Math.min(imageWidth, imageHeight);
}

export function clampOffset(
  offset: number,
  scale: number,
  imageSize: number,
  viewport: number,
): number {
  const max = Math.max(0, (imageSize * scale - viewport) / 2);
  return Math.min(max, Math.max(-max, offset));
}

export async function renderCroppedAvatar(
  source: Blob,
  transform: CropTransform,
  viewport: number,
  outPx: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  try {
    const cropSize = viewport / transform.scale;
    const sx = bitmap.width / 2 - transform.offsetX / transform.scale - cropSize / 2;
    const sy = bitmap.height / 2 - transform.offsetY / transform.scale - cropSize / 2;
    const canvas = document.createElement("canvas");
    canvas.width = outPx;
    canvas.height = outPx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, cropSize, cropSize, 0, 0, outPx, outPx);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))),
        "image/webp",
        0.92,
      );
    });
  } finally {
    bitmap.close();
  }
}
