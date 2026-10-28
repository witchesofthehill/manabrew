import { createRenderer } from "card-glint";
import type { CardDocument, Frame, Instance, Renderer, Rect, RasterHost } from "card-glint";
import { magic } from "card-glint/magic";
import { cardOpticalDocument, isSemanticLayout } from "@/lib/cardSemanticLayout";
import {
  cardInspectAppearanceDocument,
  cardInspectDocumentAppearanceKey,
} from "@/lib/cardGlintInspectAppearance";
import type { CardInspectAppearance } from "@/lib/cardGlintInspectAppearance";
import type { DeckCard, CardFinish } from "@/protocol/deck";
import { captureCardInput, prepareCard } from "@/lib/cardRenderSnapshot";
import { cardGlintFace } from "@/lib/cardRenderFace";
import { CardRenderError } from "@/lib/cardRenderDecision";
import { renderCard } from "@/lib/cardRenderer";
import { getCardArtWindows } from "@/lib/cardRenderGeometry";
import { loadScryfallImage } from "@/lib/scryfallImageSource";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import { resolveCardRainFog, resolveCardWearAmount } from "@/lib/cardFinish";
import { cardRasterHost } from "@/lib/cardOpticalLayers";
import { cardFaceImageUris, localizedDeckCardImageUris } from "@/lib/cardImage";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { CARD_NORMAL_LIGHTING_VERSION, MAX_CARD_TILT } from "@/lib/cardLighting";
import type { CardLightingMode, CardPose } from "@/lib/cardLighting";
import { recordCardRasterCopy, releaseCardRaster } from "@/lib/cardRenderTypes";
import {
  createCardGpuTimer,
  getCardGpuTimingStats,
  type CardGpuTimer,
} from "@/lib/cardRenderGpuTiming";
import { getTheme } from "@/hooks/useTheme";

const CARD_ID = 1;
const FRAME_INTERVAL = 1000 / 30;
const MAX_PIXEL_RATIO = 2;
const MAX_CANVAS_EDGE = 1200;
const CARD_MARGIN = 0.86;
const OPTICAL_FINISHES: Partial<Record<CardFinish, true>> = { rain: true, heat: true, pool: true };

const inspectStats = {
  renders: 0,
  documentPreparations: 0,
  documentUpserts: 0,
  cpuSubmissionMs: 0,
  contextRestorations: 0,
};

export function getCardInspectStats() {
  const gpuTiming = getCardGpuTimingStats("native");
  return {
    ...inspectStats,
    gpuTiming,
    gpuTimingAvailable: gpuTiming.gpuTimingAvailable,
    gpuCompletionMs: gpuTiming.gpuCompletionMs,
  };
}

export interface CardInspectState {
  status: "loading" | "ready" | "error";
  original?: boolean;
  error?: string;
}

interface InspectDocument {
  document: CardDocument;
  original: boolean;
  release?: () => void;
  rasterHost?: RasterHost;
}

async function imageDocument(
  url: string,
  revision: number,
  original: boolean,
  artWindows: readonly Rect[],
  signal: AbortSignal,
  release?: () => void,
): Promise<InspectDocument> {
  const image = new Image();
  image.src = url;
  await image.decode();
  signal.throwIfAborted();
  const size = [image.naturalWidth, image.naturalHeight] as const;
  return {
    original,
    release,
    document: {
      id: CARD_ID,
      revision,
      recipe: {
        pack: "manabrew-inspect",
        color: {
          key: url,
          size,
          async paint(host, paintSignal) {
            const lease = await host.images([{ url }], paintSignal);
            try {
              const canvas = document.createElement("canvas");
              [canvas.width, canvas.height] = size;
              const context = canvas.getContext("2d");
              const bitmap = lease.value.get(url);
              if (!context || !bitmap) throw new Error("Card image could not be prepared");
              context.drawImage(bitmap, 0, 0, ...size);
              return canvas;
            } finally {
              lease.release();
            }
          },
        },
        edges: artWindows.map((rect) => ({
          key: JSON.stringify([url, rect]),
          asset: { url, width: 512 },
          crop: rect,
          destination: rect,
          clip: rect,
          threshold: 20,
        })),
        artWindows,
        cornerRadius: 0.035,
        regions: [],
      },
    },
  };
}

async function inspectDocument(
  card: DeckCard,
  faceIndex: 0 | 1,
  finish: CardFinish,
  original: boolean,
  revision: number,
  signal: AbortSignal,
): Promise<InspectDocument> {
  if (!original) {
    try {
      await ensureCardGlintFonts();
      signal.throwIfAborted();
      const prepared = await prepareCard(captureCardInput({ deckCard: card, faceIndex }));
      signal.throwIfAborted();
      const { face } = cardGlintFace(prepared, true);
      if (!isSemanticLayout(face) || OPTICAL_FINISHES[finish]) {
        return {
          document: OPTICAL_FINISHES[finish]
            ? cardOpticalDocument(CARD_ID, revision, face, "inspect", true, {
                ink: getTheme().gameTheme.cardPrinting.ink,
                footer: getTheme().gameTheme.cardPrinting.footer,
              })
            : { id: CARD_ID, revision, recipe: magic.describe(face, "inspect") },
          original: false,
          rasterHost: cardRasterHost(prepared.artUrls),
        };
      }
      const raster = await renderCard({ deckCard: card, faceIndex }, signal, {
        standardFrameFallback: true,
        tier: "inspect",
      });
      let blob: Blob;
      let artWindows: readonly Rect[];
      try {
        artWindows = getCardArtWindows(raster).map(
          ({ x, y, width, height }) => [x, y, width, height] as const,
        );
        const canvas =
          raster instanceof HTMLCanvasElement ? raster : document.createElement("canvas");
        if (canvas !== raster) {
          canvas.width = raster.width;
          canvas.height = raster.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Card image export could not allocate a canvas");
          context.drawImage(raster, 0, 0);
          recordCardRasterCopy(raster.width, raster.height, "encoding");
        }
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) =>
            value ? resolve(value) : reject(new Error("Card image export failed")),
          ),
        );
        signal.throwIfAborted();
      } finally {
        releaseCardRaster(raster);
      }
      const url = URL.createObjectURL(blob);
      try {
        return await imageDocument(url, revision, false, artWindows, signal, () =>
          URL.revokeObjectURL(url),
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
    } catch (error) {
      if (!(error instanceof CardRenderError) || error.decision.mode !== "original") throw error;
    }
  }
  const store = useScryfallStore.getState();
  const lookup = {
    name: card.identity.name,
    setCode: card.identity.setCode || undefined,
    cardNumber: card.identity.cardNumber || undefined,
  };
  const cached = peekCard(store.cards, lookup) ?? undefined;
  const stored = localizedDeckCardImageUris(card, store.locale, faceIndex, cached);
  const entry = stored ? undefined : await store.getCard(lookup);
  signal.throwIfAborted();
  const uris =
    localizedDeckCardImageUris(
      card,
      store.locale,
      faceIndex,
      entry?.info ?? cached,
      entry?.imageInfo,
    ) ??
    (entry
      ? cardFaceImageUris(
          entry.info,
          faceIndex === 0 ? entry.uris : undefined,
          faceIndex,
          entry.imageInfo,
        )
      : undefined);
  const uri = uris?.large || uris?.normal;
  if (!uri) throw new Error("This printing has no image for the selected face");
  const url = await loadScryfallImage(uri);
  signal.throwIfAborted();
  return imageDocument(url, revision, true, [[0, 0, 1, 1]], signal);
}

export class CardGlintInspectScene {
  private revision = 0;
  private controller?: AbortController;
  private preparation?: AbortController;
  private current?: InspectDocument;
  private derived?: CardDocument;
  private appearance?: CardInspectAppearance;
  private appearanceKey?: string;
  private sourceRainFog = 1;
  private sourceDeformation?: Instance["deformation"];
  private sourceWear: Instance["wear"] = { amount: 0, seed: 0 };
  private sourceCardstock?: Instance["cardstock"];
  private sourcePrintDots?: CardInspectAppearance["printDots"];
  private sourceCoverage?: CardInspectAppearance["coverage"];
  private documentAppearance?: CardInspectAppearance;
  private documentKey?: string;
  private disposed = false;
  private ready = false;
  private contextLost = false;
  private visible = true;
  private animated = true;
  private dirty = true;
  private raf = 0;
  private previousFrame = 0;
  private effectTime = 0;
  private yaw = 0;
  private pitch = 0;
  private manualPose = false;
  private controlledPose?: CardPose;
  private landscape = false;
  private sourceAspect = 5 / 7;
  private pixelAspect = 5 / 7;
  private readonly transform = new Array<number>(16).fill(0);
  private readonly normal: [number, number, number] = [0, 0, 1];
  private readonly pointer: [number, number] = [0.5, 0.5];
  private readonly projection = new Float32Array(16);
  private readonly instance: Instance = {
    id: CARD_ID,
    card: CARD_ID,
    transform: this.transform,
    normal: this.normal,
    rainFog: 1,
  };
  private readonly instances = [this.instance];
  private readonly frame: Frame = {
    viewProjection: this.projection,
    pointer: this.pointer,
    lighting: "pointer",
    time: 0,
    clear: [0, 0, 0, 0],
  };
  private readonly resize: ResizeObserver;
  private readonly visibility: IntersectionObserver;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: Renderer;
  private readonly gpuTimer: CardGpuTimer | null;
  private rasterHost = cardRasterHost([]);
  private readonly onState: (state: CardInspectState) => void;

  private constructor(
    canvas: HTMLCanvasElement,
    renderer: Renderer,
    onState: (state: CardInspectState) => void,
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    const gl = canvas.getContext("webgl2");
    this.gpuTimer = gl ? createCardGpuTimer(gl, "native") : null;
    this.onState = onState;
    this.projection[5] = 1;
    this.projection[10] = 0.05;
    this.projection[11] = -0.12;
    this.projection[15] = 1;
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(canvas);
    this.visibility = new IntersectionObserver(([entry]) => {
      this.visible = !!entry?.isIntersecting;
      this.invalidate();
    });
    this.visibility.observe(canvas);
    document.addEventListener("visibilitychange", this.invalidate);
    canvas.addEventListener("webglcontextlost", this.loseContext);
    canvas.addEventListener("webglcontextrestored", this.restoreContext);
    this.resizeCanvas();
  }

  static async create(canvas: HTMLCanvasElement, onState: (state: CardInspectState) => void) {
    const state: { scene?: CardGlintInspectScene } = {};
    const renderer = await createRenderer({
      canvas,
      rasterHost: {
        images: (requests, signal) => {
          signal.throwIfAborted();
          const scene = state.scene;
          if (!scene) throw new Error("Card inspector is not initialized");
          return scene.rasterHost.images(requests, signal);
        },
      },
      invalidate: () => state.scene?.invalidate(),
      onError: (error) => state.scene?.failRenderer(error),
    });
    const scene = new CardGlintInspectScene(canvas, renderer, onState);
    state.scene = scene;
    return scene;
  }

  async setCard(
    card: DeckCard,
    faceIndex: 0 | 1,
    finish: CardFinish,
    original: boolean,
    landscape: boolean,
  ) {
    if (this.disposed) return;
    this.sourceRainFog = resolveCardRainFog(card.identity.cosmetics);
    this.instance.finish = finish;
    const heatDeformation = card.identity.cosmetics?.heatDeformation ?? 0;
    this.sourceDeformation =
      heatDeformation > 0 ? { kind: "heat", amount: heatDeformation } : undefined;
    this.sourceWear = {
      amount: resolveCardWearAmount(card.identity.cosmetics),
      seed: card.identity.cosmetics?.wearSeed ?? 0,
    };
    this.sourceCardstock = card.identity.cosmetics?.cardstock;
    this.sourcePrintDots = card.identity.cosmetics?.printDots;
    this.sourceCoverage = card.identity.cosmetics?.finishCoverage;
    this.applyInstanceAppearance();
    const key = JSON.stringify([
      {
        ...card,
        identity: {
          ...card.identity,
          cosmetics: {
            ...card.identity.cosmetics,
            rainFog: undefined,
            heatDeformation: undefined,
            wear: undefined,
            wearAmount: undefined,
            wearSeed: undefined,
            cardstock: undefined,
            printDots: undefined,
            finishCoverage: undefined,
          },
        },
      },
      faceIndex,
      finish,
      original,
      landscape,
      useScryfallStore.getState().locale,
    ]);
    if (this.documentKey === key && (this.ready || this.controller || this.preparation)) {
      this.updateDocumentAppearance();
      this.invalidate();
      return;
    }
    this.documentKey = key;
    this.controller?.abort();
    this.preparation?.abort();
    this.preparation = undefined;
    this.ready = false;
    this.renderer.releaseCards(new Uint32Array([CARD_ID]));
    this.current?.release?.();
    this.current = undefined;
    this.derived = undefined;
    this.appearanceKey = undefined;
    const controller = new AbortController();
    this.controller = controller;
    const revision = ++this.revision;
    this.onState({ status: "loading" });
    let prepared: InspectDocument | undefined;
    try {
      prepared = await inspectDocument(
        card,
        faceIndex,
        finish,
        original,
        revision,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      this.rasterHost = prepared.rasterHost ?? cardRasterHost([]);
      this.current = prepared;
      prepared = undefined;
      const size = this.current.document.recipe.color.size;
      this.sourceAspect = size[0] / size[1];
      this.landscape = landscape;
      this.instance.finish = finish;
      this.applyInstanceAppearance();
      this.updateDocumentAppearance();
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed) this.fail(error);
    } finally {
      prepared?.release?.();
      if (this.controller === controller) this.controller = undefined;
    }
  }

  setAppearance(appearance?: CardInspectAppearance) {
    if (this.disposed) return;
    this.appearance = appearance;
    this.applyInstanceAppearance();
    this.updateDocumentAppearance();
    this.invalidate();
  }

  private applyInstanceAppearance() {
    this.instance.rainFog = this.appearance?.rainFog ?? this.sourceRainFog;
    this.instance.wear = this.appearance?.wear ?? this.sourceWear;
    this.instance.cardstock = this.appearance?.cardstock ?? this.sourceCardstock;
    const printDots = this.appearance?.printDots ?? this.sourcePrintDots;
    this.instance.printDots = printDots
      ? {
          ...printDots,
          period: printDots.period ?? 5,
          artwork: this.current?.original ? true : printDots.artwork,
        }
      : undefined;
    this.instance.deformation =
      this.instance.finish === "heat"
        ? (this.appearance?.deformation ?? this.sourceDeformation)
        : undefined;
    this.documentAppearance =
      this.sourceCoverage && !this.appearance?.coverage
        ? { ...this.appearance, coverage: this.sourceCoverage }
        : this.appearance;
  }

  private updateDocumentAppearance() {
    if (!this.current || this.preparation || this.disposed) return;
    const key = cardInspectDocumentAppearanceKey(this.documentAppearance);
    if (this.derived && this.appearanceKey === key) return;
    try {
      const derived = cardInspectAppearanceDocument(
        this.current.document,
        ++this.revision,
        this.documentAppearance,
      );
      this.renderer.upsertCards([derived]);
      inspectStats.documentUpserts += 1;
      this.derived = derived;
      this.appearanceKey = key;
      void this.prepareCurrent();
    } catch (error) {
      this.failRenderer(error);
    }
  }

  private async prepareCurrent() {
    const current = this.current;
    const derived = this.derived;
    if (!current || !derived || this.disposed || this.contextLost) return;
    this.preparation?.abort();
    const controller = new AbortController();
    this.preparation = controller;
    this.ready = false;
    try {
      inspectStats.documentPreparations += 1;
      await this.renderer.ready(CARD_ID, derived.revision, controller.signal);
      if (
        controller.signal.aborted ||
        this.disposed ||
        this.contextLost ||
        this.current !== current ||
        this.derived !== derived ||
        this.appearanceKey !== cardInspectDocumentAppearanceKey(this.documentAppearance)
      )
        return;
      this.ready = true;
      this.onState({ status: "ready", original: current.original });
      this.invalidate();
    } catch (error) {
      if (!controller.signal.aborted && !this.disposed && this.current === current)
        this.failRenderer(error);
    } finally {
      if (this.preparation === controller) this.preparation = undefined;
      if (this.current === current && !this.contextLost) this.updateDocumentAppearance();
    }
  }

  private loseContext = (event: Event) => {
    event.preventDefault();
    if (this.disposed) return;
    this.contextLost = true;
    this.gpuTimer?.reset();
    this.ready = false;
    this.preparation?.abort();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.previousFrame = 0;
    if (this.current || this.controller) this.onState({ status: "loading" });
  };

  private restoreContext = () => {
    if (this.disposed) return;
    this.gpuTimer?.reset();
    inspectStats.contextRestorations += 1;
    this.contextLost = false;
    this.resizeCanvas();
    void this.prepareCurrent();
  };

  private failRenderer(error: unknown) {
    if (this.contextLost || this.canvas.getContext("webgl2")?.isContextLost()) return;
    this.fail(error);
  }

  private fail(error: unknown) {
    if (this.disposed) return;
    this.ready = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  setAnimated(animated: boolean) {
    this.animated = animated;
    this.previousFrame = 0;
    this.invalidate();
  }

  setLighting(lighting: CardLightingMode = "pointer") {
    if (lighting === "studio" && CARD_NORMAL_LIGHTING_VERSION !== 1)
      throw new Error("Card Glint normal lighting version 1 is required");
    this.frame.lighting = lighting;
    this.invalidate();
  }

  setPose(pose?: CardPose) {
    this.controlledPose = pose;
    this.invalidate();
  }

  point(x: number, y: number) {
    const bounds = this.canvas.getBoundingClientRect();
    const px = (x - bounds.left) / bounds.width;
    const py = (y - bounds.top) / bounds.height;
    this.pointer[0] = px;
    this.pointer[1] = py;
    if (!this.controlledPose && this.frame.lighting !== "studio") {
      this.yaw = (px - 0.5) * MAX_CARD_TILT;
      this.pitch = (py - 0.5) * MAX_CARD_TILT;
      this.manualPose = true;
    }
    const hit = this.renderer.hitTest(x - bounds.left, y - bounds.top);
    this.frame.hover = hit ? { instance: hit.instance, uv: hit.uv } : undefined;
    this.invalidate();
  }

  leavePoint() {
    this.pointer[0] = this.pointer[1] = 0.5;
    this.frame.hover = undefined;
    if (!this.controlledPose && this.frame.lighting !== "studio") this.reset();
    else this.invalidate();
  }

  tilt(x: number, y: number) {
    this.yaw = Math.max(-MAX_CARD_TILT, Math.min(MAX_CARD_TILT, this.yaw + x));
    this.pitch = Math.max(-MAX_CARD_TILT, Math.min(MAX_CARD_TILT, this.pitch + y));
    this.manualPose = true;
    this.frame.hover = undefined;
    this.invalidate();
  }

  reset = () => {
    this.yaw = this.pitch = 0;
    this.manualPose = false;
    this.pointer[0] = this.pointer[1] = 0.5;
    this.frame.hover = undefined;
    this.invalidate();
  };

  private resizeCanvas() {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.min(
      MAX_PIXEL_RATIO,
      window.devicePixelRatio || 1,
      MAX_CANVAS_EDGE / Math.max(bounds.width, bounds.height),
    );
    this.canvas.width = Math.round(bounds.width * ratio);
    this.canvas.height = Math.round(bounds.height * ratio);
    this.pixelAspect = bounds.width / bounds.height;
    this.projection[0] = 1 / this.pixelAspect;
    this.invalidate();
  }

  private invalidate = () => {
    this.dirty = true;
    if (
      !this.raf &&
      !this.disposed &&
      !this.contextLost &&
      this.ready &&
      this.visible &&
      !document.hidden
    ) {
      this.raf = requestAnimationFrame(this.draw);
    }
  };

  private draw = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.contextLost || !this.visible || document.hidden || !this.ready)
      return;
    if (this.previousFrame && now - this.previousFrame < FRAME_INTERVAL && !this.dirty) {
      if (this.animated) this.raf = requestAnimationFrame(this.draw);
      return;
    }
    if (this.animated)
      this.effectTime += Math.min(0.05, this.previousFrame ? (now - this.previousFrame) / 1000 : 0);
    this.previousFrame = now;
    this.dirty = false;
    const yaw =
      this.controlledPose?.yaw ??
      (this.manualPose ? this.yaw : this.animated ? Math.sin(this.effectTime * 0.7) * 0.14 : 0);
    const pitch =
      this.controlledPose?.pitch ??
      (this.manualPose ? this.pitch : this.animated ? Math.cos(this.effectTime * 0.5) * 0.09 : 0);
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      cx = Math.cos(pitch),
      sx = Math.sin(pitch);
    const rotate = this.landscape && this.sourceAspect < 1;
    const physicalWidth = rotate ? 1 : this.sourceAspect;
    const physicalHeight = rotate ? this.sourceAspect : 1;
    const scale =
      CARD_MARGIN * Math.min((2 * this.pixelAspect) / physicalWidth, 2 / physicalHeight);
    const width = this.sourceAspect * scale;
    const height = scale;
    const cos = rotate ? 0 : 1,
      sin = rotate ? -1 : 0;
    const m = this.transform;
    m[0] = (cy * cos + sy * sx * sin) * width;
    m[1] = cx * sin * width;
    m[2] = (-sy * cos + cy * sx * sin) * width;
    m[4] = (-cy * sin + sy * sx * cos) * -height;
    m[5] = cx * cos * -height;
    m[6] = (sy * sin + cy * sx * cos) * -height;
    m[10] = 1;
    m[12] = -(m[0]! + m[4]!) / 2;
    m[13] = -(m[1]! + m[5]!) / 2;
    m[14] = -(m[2]! + m[6]!) / 2;
    m[15] = 1;
    this.normal[0] = sy * cx;
    this.normal[1] = -sx;
    this.normal[2] = cy * cx;
    this.frame.time = this.effectTime;
    const submissionStarted = performance.now();
    try {
      this.gpuTimer?.begin();
      this.renderer.updateScene(this.instances);
      this.renderer.render(this.frame);
      inspectStats.renders += 1;
    } catch (error) {
      this.failRenderer(error);
      return;
    } finally {
      this.gpuTimer?.end();
      inspectStats.cpuSubmissionMs += performance.now() - submissionStarted;
    }
    if (this.animated) this.raf = requestAnimationFrame(this.draw);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.preparation?.abort();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resize.disconnect();
    this.visibility.disconnect();
    document.removeEventListener("visibilitychange", this.invalidate);
    this.canvas.removeEventListener("webglcontextlost", this.loseContext);
    this.canvas.removeEventListener("webglcontextrestored", this.restoreContext);
    this.gpuTimer?.destroy();
    this.renderer.dispose();
    this.current?.release?.();
    this.current = undefined;
    this.derived = undefined;
  }
}
