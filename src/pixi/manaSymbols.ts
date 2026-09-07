import type { Sprite, Texture } from "pixi.js";
import type { ManaCode } from "@/types/scryfall";
import { normalizeManaCode } from "@/api/scryfall";
import { getManaSymbolTextureSync, loadManaSymbolTexture } from "./manaSymbolCache";

const pendingSprites = new Map<ManaCode, Map<Sprite, number>>();
const loadingSymbols = new Set<ManaCode>();

export function parseManaCost(cost: string | undefined): ManaCode[] {
  if (!cost || cost === "no cost") return [];
  const tokens = cost.includes("{")
    ? (cost.match(/\{[^}]+\}/g) ?? []).map((m) => m.slice(1, -1).trim())
    : cost.split(/\s+/);
  return tokens.map(normalizeManaCode).filter((c): c is ManaCode => c != null);
}

function settlePendingSprites(code: ManaCode, texture?: Texture): void {
  const pending = pendingSprites.get(code);
  pendingSprites.delete(code);
  if (!texture) return;

  pending?.forEach((size, sprite) => {
    if (sprite.destroyed) return;
    sprite.texture = texture;
    sprite.width = size;
    sprite.height = size;
  });
}

function raster(code: ManaCode): void {
  if (loadingSymbols.has(code)) return;
  loadingSymbols.add(code);
  const completion = loadManaSymbolTexture(code)
    .then(
      (texture) => {
        loadingSymbols.delete(code);
        settlePendingSprites(code, texture);
      },
      () => {
        loadingSymbols.delete(code);
        settlePendingSprites(code);
      },
    )
    .catch(() => {
      loadingSymbols.delete(code);
      pendingSprites.delete(code);
    });
  void completion;
}

export function applyManaSymbol(sprite: Sprite, code: ManaCode, size: number): void {
  if (sprite.destroyed) return;
  sprite.width = size;
  sprite.height = size;
  const cached = getManaSymbolTextureSync(code);
  if (cached) {
    sprite.texture = cached;
    return;
  }

  let pending = pendingSprites.get(code);
  if (!pending) {
    pending = new Map();
    pendingSprites.set(code, pending);
  }
  pending.set(sprite, size);
  raster(code);
}
