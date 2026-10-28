import { composeCardTexture } from "card-glint/magic/presentation";
import type { RenderedCardInput } from "card-glint/magic/presentation";
import { closeRaster } from "card-glint/canvas";
import {
  composeSemanticCardTexture,
  cardOpticalDocument,
  isSemanticLayout,
} from "@/lib/cardSemanticLayout";
import type { CardSemanticPalette } from "@/lib/cardSemanticLayout";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import { cardImageLoader } from "@/lib/cardRenderArtwork";
import { disposeCardLiveHighlights, extractCardLiveHighlights } from "@/lib/cardLiveHighlights";
import type { CardLiveHighlightLayers } from "@/lib/cardLiveHighlights";
import type { CardRaster, CardRenderTier } from "@/lib/cardRenderTypes";
import type { RasterHost } from "card-glint";

export interface CardCompositionInput {
  key: string;
  face: RenderedCardInput;
  printingId: string | null;
  artUrls: readonly (string | undefined)[];
  rulesText: boolean;
  tier: CardRenderTier;
  palette: CardSemanticPalette;
  optical?: boolean;
  etching?: boolean;
}

export interface CardCompositionResult {
  key: string;
  raster: CardRaster;
  highlights?: CardLiveHighlightLayers;
  printing?: CardRaster;
}

function withoutLiveInk<T extends RenderedCardInput>(face: T, colors: Set<string>): T {
  const faces = face.faces?.map((child) => withoutLiveInk(child, colors));
  if (!face.textInk && (!faces || faces.every((child, index) => child === face.faces![index])))
    return face;
  if (face.textInk) {
    for (const spans of [face.textInk.stats, face.textInk.typeLine])
      for (const span of spans ?? []) colors.add(span.color);
  }
  return { ...face, textInk: face.textInk ? { ...face.textInk, omitInk: true } : undefined, faces };
}

export function disposeCardComposition(result: CardCompositionResult): void {
  closeRaster(result.raster);
  if (result.printing) closeRaster(result.printing);
  disposeCardLiveHighlights(result.highlights);
}

export async function composeCardRaster(
  input: CardCompositionInput,
  signal: AbortSignal,
): Promise<CardCompositionResult> {
  await ensureCardGlintFonts();
  signal.throwIfAborted();
  const loadImages = cardImageLoader(input.artUrls);
  const paint = (face: RenderedCardInput): Promise<CardRaster> =>
    isSemanticLayout(face)
      ? composeSemanticCardTexture(face, input.tier, signal, {
          palette: input.palette,
          rulesText: input.rulesText,
          loadImages,
          loadFonts: ensureCardGlintFonts,
        })
      : composeCardTexture(
          {
            face,
            printingId: input.printingId,
            printedImage: null,
            rulesText: input.rulesText,
            ...(input.etching ? { layer: "etching" as const } : {}),
          },
          input.tier,
          signal,
          { loadImages, loadFonts: ensureCardGlintFonts, loadRetroFont: ensureCardGlintFonts },
        );
  let raster: CardRaster | undefined;
  let printing: CardRaster | undefined;
  let highlights: CardLiveHighlightLayers | undefined;
  try {
    if (input.optical) {
      const document = cardOpticalDocument(
        0,
        0,
        input.face,
        input.tier,
        input.rulesText,
        input.palette,
      );
      const host: RasterHost = {
        async images(requests, imageSignal) {
          const lease = await loadImages(
            requests.map(({ url }) => url),
            imageSignal,
          );
          return { value: lease.images, release: lease.dispose };
        },
      };
      raster = await document.recipe.color.paint(host, signal);
      const layer = document.layers?.[0];
      if (!layer) throw new Error("Card optical printing layer is unavailable");
      printing = await layer.raster.paint(host, signal);
    } else {
      raster = await paint(input.face);
      signal.throwIfAborted();
      const colors = new Set<string>();
      const backingFace = input.etching ? input.face : withoutLiveInk(input.face, colors);
      if (backingFace !== input.face) {
        const backing = await paint(backingFace);
        try {
          signal.throwIfAborted();
          highlights = await extractCardLiveHighlights(raster, backing, [...colors]);
        } finally {
          closeRaster(backing);
        }
      }
    }
    signal.throwIfAborted();
    return { key: input.key, raster, highlights, printing };
  } catch (error) {
    if (raster) closeRaster(raster);
    if (printing) closeRaster(printing);
    disposeCardLiveHighlights(highlights);
    throw error;
  }
}
