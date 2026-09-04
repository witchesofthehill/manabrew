import { ImageSource, Texture } from "pixi.js";
import { fetchImageElement } from "@/api/scryfall";

const RASTER_SIZE = 96;
const textures = new Map<string, Texture>();
const loading = new Map<string, Promise<Texture>>();

async function loadSetSymbolTexture(url: string): Promise<Texture> {
  const image = await fetchImageElement(url);
  const canvas = document.createElement("canvas");
  canvas.width = RASTER_SIZE;
  canvas.height = RASTER_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2d canvas unavailable");

  const width = image.naturalWidth || RASTER_SIZE;
  const height = image.naturalHeight || RASTER_SIZE;
  const scale = Math.min(RASTER_SIZE / width, RASTER_SIZE / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.drawImage(
    image,
    (RASTER_SIZE - drawWidth) / 2,
    (RASTER_SIZE - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, RASTER_SIZE, RASTER_SIZE);

  const texture = new Texture({ source: new ImageSource({ resource: canvas }) });
  textures.set(url, texture);
  return texture;
}

export function setSymbolTexture(url: string): Promise<Texture> {
  const cached = textures.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(url);
  if (pending) return pending;
  const promise = loadSetSymbolTexture(url).finally(() => loading.delete(url));
  loading.set(url, promise);
  return promise;
}
