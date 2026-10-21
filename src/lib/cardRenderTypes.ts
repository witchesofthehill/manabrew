import type { CardFaceSnapshot } from "@/lib/cardRenderSnapshot";
import { closeRaster } from "card-glint/canvas";

export type CardRaster = HTMLCanvasElement | ImageBitmap;
export type CardRenderTier = "table" | "native" | "inspect";

interface RasterOwner {
  refs: number;
  bytes: number;
  dispose?: () => void;
}

const owners = new Map<CardRaster, RasterOwner>();
let closedRasters = 0;
let peakRasterBytes = 0;
const copies = { domRasterCopies: 0, encodingRasterCopies: 0, rasterCopyBytes: 0 };

export function recordCardRasterCopy(
  width: number,
  height: number,
  kind: "dom" | "encoding",
): void {
  if (kind === "dom") copies.domRasterCopies++;
  else copies.encodingRasterCopies++;
  copies.rasterCopyBytes += width * height * 4;
}

export function ownCardRaster(source: CardRaster, bytes: number, dispose?: () => void): void {
  if (owners.has(source)) throw new Error("Card raster already has an owner");
  owners.set(source, { refs: 1, bytes, dispose });
  peakRasterBytes = Math.max(peakRasterBytes, cardRasterStats().rasterBytes);
}

export function retainCardRaster(source: CardRaster): () => void {
  const owner = owners.get(source);
  if (owner) owner.refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCardRaster(source);
  };
}

export function releaseCardRaster(source: CardRaster): void {
  const owner = owners.get(source);
  if (!owner || --owner.refs > 0) return;
  owners.delete(source);
  owner.dispose?.();
  closeRaster(source);
  closedRasters++;
}

export function cardRasterStats(cachedSources?: ReadonlySet<CardRaster>) {
  let rasterBytes = 0;
  let rasterReferences = 0;
  let activeRasterBytes = 0;
  for (const [source, owner] of owners) {
    rasterBytes += owner.bytes;
    rasterReferences += owner.refs;
    if (owner.refs > Number(Boolean(cachedSources?.has(source)))) activeRasterBytes += owner.bytes;
  }
  return {
    ...copies,
    rasterBytes,
    activeRasterBytes,
    idleRasterBytes: rasterBytes - activeRasterBytes,
    rasterReferences,
    liveRasters: owners.size,
    closedRasters,
    peakRasterBytes,
  };
}

const TIER_WIDTH = { table: 244, native: 488, inspect: 732 } as const;
const TIERS: readonly CardRenderTier[] = ["table", "native", "inspect"];

export function selectCardRenderTier(
  projectedWidth: number,
  projectedHeight?: number,
  density = globalThis.devicePixelRatio ?? 1,
  previous?: CardRenderTier,
  flipping = false,
): CardRenderTier {
  const height = projectedHeight ?? 0;
  const rotated = height > 0 && projectedWidth > height;
  const pixels =
    Math.max(rotated ? height : projectedWidth, (rotated ? projectedWidth : height) * (488 / 680)) *
    Math.max(1, Math.min(2, density));
  const suitable = TIERS.find((tier) => pixels <= TIER_WIDTH[tier]) ?? "inspect";
  if (!previous || previous === suitable) return suitable;
  const current = TIERS.indexOf(previous);
  const next = TIERS.indexOf(suitable);
  if (next > current) return pixels > TIER_WIDTH[previous] * 1.1 ? suitable : previous;
  if (flipping || pixels >= TIER_WIDTH[TIERS[current - 1]!] * 0.85) return previous;
  return suitable;
}

export interface CardSnapshot extends CardFaceSnapshot {
  card_faces?: readonly CardFaceSnapshot[];
  keywords?: string[];
  rarity?: string;
  set?: string;
  collector_number?: string;
  frame?: string;
  frame_effects?: string[];
  border_color?: string;
  security_stamp?: string;
  full_art?: boolean;
  textless?: boolean;
  promo_types?: string[];
  lang?: string;
  released_at?: string;
}
