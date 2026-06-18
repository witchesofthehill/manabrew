import { Sprite, Texture } from "pixi.js";
import type { ManaCode } from "@/types/scryfall";
import { manaSymbolUrl, normalizeManaCode } from "@/api/scryfall";

const texCache = new Map<string, Texture>();
const pendingSprites = new Map<string, Set<Sprite>>();

export function parseManaCost(cost: string | undefined): ManaCode[] {
  if (!cost || cost === "no cost") return [];
  const tokens = cost.includes("{")
    ? (cost.match(/\{[^}]+\}/g) ?? []).map((m) => m.slice(1, -1).trim())
    : cost.split(/\s+/);
  return tokens.map(normalizeManaCode).filter((c): c is ManaCode => c != null);
}

function raster(code: ManaCode, size: number): void {
  const key = `${code}:${size}`;
  if (texCache.has(key)) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.width = size;
  img.height = size;
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    c.getContext("2d")!.drawImage(img, 0, 0, size, size);
    const tex = Texture.from(c);
    texCache.set(key, tex);
    pendingSprites.get(key)?.forEach((spr) => {
      if (spr.destroyed) return;
      spr.texture = tex;
      spr.width = size;
      spr.height = size;
    });
    pendingSprites.delete(key);
  };
  img.onerror = () => pendingSprites.delete(key);
  img.src = manaSymbolUrl(code);
}

export function applyManaSymbol(sprite: Sprite, code: ManaCode, size: number): void {
  sprite.width = size;
  sprite.height = size;
  const key = `${code}:${size}`;
  const cached = texCache.get(key);
  if (cached) {
    sprite.texture = cached;
    return;
  }
  raster(code, size);
  if (!pendingSprites.has(key)) pendingSprites.set(key, new Set());
  pendingSprites.get(key)!.add(sprite);
}
