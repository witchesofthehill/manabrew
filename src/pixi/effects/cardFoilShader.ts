import { SurfaceMotion, surfaceSeed } from "card-glint/finish";
import { MeshGeometry, Shader, Texture, UniformGroup } from "pixi.js";
import type { CardLightingMode } from "@/lib/cardLighting";
import { getCardFoilProgram, MAX_CARD_FOIL_EXCLUSIONS } from "./cardFoilPrograms";
export { MAX_CARD_FOIL_EXCLUSIONS } from "./cardFoilPrograms";
import {
  CARD_FINISH_KINDS,
  resolveCardRainFog,
  resolveCardWearAmount,
  type CardFoilRegion,
} from "@/lib/cardFinish";
import type { CardCosmetics, CardFinish } from "@/protocol/deck";
import {
  acquireCardOpticalLayers,
  getCardSourceCornerRadius,
  type CardOpticalLease,
} from "@/lib/cardOpticalLayers";
import {
  acquireCardFinishMask,
  acquireCardFinishCaustics,
  acquireCardFinishPrinting,
  acquireCardFinishCoverage,
  acquireCardFinishCardstock,
  type CardFinishMaskLease,
  type CardFinishCausticsLease,
  type CardFinishPrintingLease,
} from "@/lib/cardFinishResources";

export type CardFoilTextureRole = "face" | "mask" | "printing" | "coverage";

export interface CardFoilUniforms {
  uSize: Float32Array;
  uRadius: number;
  uExclusions: Float32Array;
  uExclusionCount: number;
  uUvTop: Float32Array;
  uUvBottom: Float32Array;
  pointer: Float32Array;
  aspect: number;
  artBounds: Float32Array;
  hasMask: number;
  maskBottomUp: number;
  hasWave: number;
  previewKind: number;
  hasPrinting: number;
  satinCompact: number;
  satinHoverGain: number;
  cornerRadius: number;
  finishBase: number;
  hasCoverage: number;
  facePrepared: number;
  printingPrepared: number;
  cardstockAmount: number;
  regularPrinting: number;
  surfaceTime: number;
  rainFogDensity: number;
  heatDeformation: number;
  surfaceInfo: Float32Array;
  ripple0: Float32Array;
  ripple1: Float32Array;
  ripple2: Float32Array;
  ripple3: Float32Array;
  wearInfo: Float32Array;
  studioLighting: number;
  cardNormal: Float32Array;
  facePixelSize: Float32Array;
  printDotsInfo: Float32Array;
  printArtwork: number;
  faceProcedural: number;
  printingProcedural: number;
}

export interface CardFoilShader {
  shader: Shader;
  geometry: MeshGeometry;
  uniforms: CardFoilUniforms;
  readonly textures: Record<CardFoilTextureRole, Texture>;
  readonly artWindowCount: number;
  setLighting(mode: CardLightingMode, normal: ArrayLike<number>): void;
  setTexture(texture: Texture | null, uvs?: Float32Array): void;
  setMode(mode: CardFinish, cosmetics?: CardCosmetics): void;
  setArtWindows(regions: readonly CardFoilRegion[]): void;
  setExclusions(regions: readonly CardFoilRegion[]): void;
  update(time: number, hovering: boolean): void;
  destroy(): void;
}

let shared: { geometry: MeshGeometry; users: number } | null = null;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const viewProjection = new Float32Array(identity);

export function createCardFoilShader(invalidate: () => void): CardFoilShader {
  shared ??= {
    geometry: new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    }),
    users: 0,
  };
  const resources = shared;
  resources.users++;
  const group = new UniformGroup({
    uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    uRadius: { value: 0, type: "f32" },
    uExclusions: {
      value: new Float32Array(MAX_CARD_FOIL_EXCLUSIONS * 4),
      type: "vec4<f32>",
      size: MAX_CARD_FOIL_EXCLUSIONS,
    },
    uExclusionCount: { value: 0, type: "i32" },
    uUvTop: { value: new Float32Array([0, 0, 1, 0]), type: "vec4<f32>" },
    uUvBottom: { value: new Float32Array([0, 1, 1, 1]), type: "vec4<f32>" },
    pointer: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
    aspect: { value: 1.4, type: "f32" },
    artBounds: { value: new Float32Array(32), type: "vec4<f32>", size: 8 },
    hasMask: { value: 0, type: "f32" },
    maskBottomUp: { value: 0, type: "f32" },
    hasWave: { value: 0, type: "f32" },
    previewKind: { value: 0, type: "f32" },
    hasPrinting: { value: 0, type: "f32" },
    satinCompact: { value: 1, type: "f32" },
    satinHoverGain: { value: 0, type: "f32" },
    cornerRadius: { value: 0.035, type: "f32" },
    finishBase: { value: 1, type: "f32" },
    hasCoverage: { value: 0, type: "f32" },
    facePrepared: { value: 0, type: "f32" },
    printingPrepared: { value: 0, type: "f32" },
    cardstockAmount: { value: 0, type: "f32" },
    regularPrinting: { value: 1, type: "f32" },
    surfaceTime: { value: 0, type: "f32" },
    rainFogDensity: { value: 1, type: "f32" },
    heatDeformation: { value: 0, type: "f32" },
    surfaceInfo: { value: new Float32Array(4), type: "vec4<f32>" },
    ripple0: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple1: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple2: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    ripple3: { value: new Float32Array([0, 0, -100, 0]), type: "vec4<f32>" },
    wearInfo: { value: new Float32Array(2), type: "vec2<f32>" },
    studioLighting: { value: 0, type: "f32" },
    cardNormal: { value: new Float32Array([0, 0, 1]), type: "vec3<f32>" },
    facePixelSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
    printDotsInfo: { value: new Float32Array([0, 5, 0.5, 0]), type: "vec4<f32>" },
    printArtwork: { value: 1, type: "f32" },
    faceProcedural: { value: 0, type: "f32" },
    printingProcedural: { value: 0, type: "f32" },
  });
  const shader = new Shader({
    glProgram: getCardFoilProgram(false, false),
    resources: {
      foilUniforms: group,
      face: Texture.EMPTY.source,
      mask: Texture.EMPTY.source,
      caustics: Texture.EMPTY.source,
      printing: Texture.EMPTY.source,
      coverage: Texture.EMPTY.source,
      cardstockMap: Texture.EMPTY.source,
    },
  });
  const textures: Record<CardFoilTextureRole, Texture> = {
    face: Texture.EMPTY,
    mask: Texture.EMPTY,
    printing: Texture.EMPTY,
    coverage: Texture.EMPTY,
  };
  const bindTexture = (role: CardFoilTextureRole, texture: Texture) => {
    textures[role] = texture;
    shader.resources[role] = texture.source;
  };
  const motion = new SurfaceMotion();
  const normal: [number, number, number] = [0, 0, 1];
  const hoverUv: [number, number] = [0.5, 0.5];
  let mode: CardFinish = "regular";
  let source: Texture | null = null;
  let controller: AbortController | null = null;
  let maskLease: CardFinishMaskLease | null = null;
  let poolLease: CardFinishCausticsLease | null = null;
  let cardstockLease: CardFinishMaskLease | null = null;
  let opticalLease: CardOpticalLease | null = null;
  let printingLeases: CardFinishPrintingLease[] = [];
  let coverageLease: CardFinishMaskLease | null = null;
  let materialController: AbortController | null = null;
  let materialKey = "";
  let cosmetics: CardCosmetics | undefined;
  let destroyed = false;
  let artWindows: readonly CardFoilRegion[] = [];
  const syncCardstock = () => {
    if (group.uniforms.cardstockAmount > 0 && source && !cardstockLease) {
      try {
        cardstockLease = acquireCardFinishCardstock();
        shader.resources.cardstockMap = cardstockLease.texture.source;
      } catch (error) {
        console.error("Card Glint cardstock unavailable", error);
      }
    }
    if ((mode === "regular" || !source) && cardstockLease) {
      shader.resources.cardstockMap = Texture.EMPTY.source;
      cardstockLease.release();
      cardstockLease = null;
    }
  };
  const setArtWindows = (regions: readonly CardFoilRegion[]) => {
    const bounds = group.uniforms.artBounds;
    bounds.fill(0);
    if (!regions.length) {
      bounds[2] = 1;
      bounds[3] = 1;
    }
    for (let index = 0; index < Math.min(8, regions.length); index++) {
      const region = regions[index];
      const offset = index * 4;
      bounds[offset] = region.x;
      bounds[offset + 1] = 1 - region.y - region.height;
      bounds[offset + 2] = region.x + region.width;
      bounds[offset + 3] = 1 - region.y;
    }
  };
  const releaseMaterial = () => {
    materialController?.abort();
    materialController = null;
    bindTexture("face", source ?? Texture.EMPTY);
    bindTexture("printing", Texture.EMPTY);
    bindTexture("coverage", Texture.EMPTY);
    group.uniforms.faceProcedural = 0;
    group.uniforms.printingProcedural = 0;
    shader.glProgram = getCardFoilProgram(false, false);
    group.uniforms.hasPrinting = 0;
    group.uniforms.hasCoverage = 0;
    group.uniforms.facePrepared = 0;
    group.uniforms.printingPrepared = 0;
    group.uniforms.finishBase = 1;
    opticalLease?.release();
    opticalLease = null;
    for (const lease of printingLeases) lease.release();
    printingLeases = [];
    coverageLease?.release();
    coverageLease = null;
    group.uniforms.cornerRadius = source ? getCardSourceCornerRadius(source) : 0.035;
    setArtWindows(artWindows);
  };
  const syncMaterial = (preserveOptical = true) => {
    if (destroyed) return;
    const optical = mode === "rain" || mode === "heat" || mode === "pool";
    const dots = cosmetics?.printDots;
    const settings =
      dots && dots.amount > 0
        ? {
            amount: dots.amount,
            period: dots.period ?? 5,
            variation: dots.variation ?? 0.5,
            inset: dots.inset ?? 0,
            ...(dots.artwork === false ? { artwork: false as const } : {}),
          }
        : undefined;
    const key = JSON.stringify([optical, settings, cosmetics?.finishCoverage, artWindows]);
    if (materialController && materialKey === key) return;
    materialKey = key;
    const retained = preserveOptical && optical ? opticalLease : null;
    if (retained) opticalLease = null;
    releaseMaterial();
    if (!source) return;
    const texture = source;
    const pending = new AbortController();
    materialController = pending;
    const signal = pending.signal;
    void (async () => {
      let layers: CardOpticalLease | null = retained;
      let coverage: CardFinishMaskLease | null = null;
      const printing: CardFinishPrintingLease[] = [];
      try {
        if (optical && !layers) layers = await acquireCardOpticalLayers(texture, signal);
        signal.throwIfAborted();
        coverage = await acquireCardFinishCoverage(
          texture,
          cosmetics?.finishCoverage,
          optical,
          artWindows,
          signal,
        );
        signal.throwIfAborted();
        if (settings) {
          printing.push(
            await acquireCardFinishPrinting(
              layers?.artwork ?? texture,
              settings,
              signal,
              layers?.artWindows ?? artWindows,
            ),
          );
          signal.throwIfAborted();
          if (layers) {
            printing.push(
              await acquireCardFinishPrinting(layers.printing, settings, signal, layers.artWindows),
            );
            signal.throwIfAborted();
          }
        }
        opticalLease = layers;
        coverageLease = coverage;
        printingLeases = printing;
        bindTexture("face", printing[0]?.texture ?? layers?.artwork ?? texture);
        bindTexture("printing", printing[1]?.texture ?? layers?.printing ?? Texture.EMPTY);
        bindTexture("coverage", coverage.texture);
        group.uniforms.hasPrinting = layers ? 1 : 0;
        group.uniforms.hasCoverage = 1;
        group.uniforms.finishBase = layers ? 0 : 1;
        group.uniforms.facePrepared = printing[0]?.texture ? 1 : 0;
        group.uniforms.printingPrepared = printing[1]?.texture ? 1 : 0;
        group.uniforms.faceProcedural = printing[0]?.procedural ? 1 : 0;
        group.uniforms.printingProcedural = printing[1]?.procedural ? 1 : 0;
        group.uniforms.printDotsInfo.set([
          settings?.amount ?? 0,
          settings?.period ?? 5,
          settings?.variation ?? 0.5,
          settings?.inset ?? 0,
        ]);
        group.uniforms.printArtwork =
          settings?.artwork === false && (layers?.artWindows ?? artWindows).length > 0 ? 0 : 1;
        shader.glProgram = getCardFoilProgram(
          false,
          printing.some((lease) => lease.procedural),
        );
        if (layers) {
          group.uniforms.cornerRadius = layers.cornerRadius;
          setArtWindows(layers.artWindows);
        }
        invalidate();
      } catch (error) {
        for (const lease of printing) lease.release();
        coverage?.release();
        layers?.release();
        if (!signal.aborted) console.error("Card Glint finish material unavailable", error);
      }
    })();
  };
  const sourceChanged = () => {
    syncCardstock();
    materialKey = "";
    syncMaterial(false);
    controller?.abort();
    controller = null;
    bindTexture("mask", Texture.EMPTY);
    group.uniforms.hasMask = 0;
    maskLease?.release();
    maskLease = null;
    if (!source || source.destroyed || source.source.destroyed) return;
    group.uniforms.aspect = source.source.pixelHeight / source.source.pixelWidth;
    group.uniforms.facePixelSize.set([source.source.pixelWidth, source.source.pixelHeight]);
    const pending = new AbortController();
    controller = pending;
    void acquireCardFinishMask(source, pending.signal)
      .then((lease) => {
        if (pending.signal.aborted) {
          lease.release();
          return;
        }
        maskLease = lease;
        bindTexture("mask", lease.texture);
        group.uniforms.hasMask = 1;
        group.uniforms.maskBottomUp = lease.texture.source.format === "r8unorm" ? 1 : 0;
        invalidate();
      })
      .catch((error: unknown) => {
        if (!pending.signal.aborted) console.error("Card Glint artwork mask unavailable", error);
      });
    invalidate();
  };
  const queueSourceChange = () => {
    materialController?.abort();
    controller?.abort();
    const changed = source;
    queueMicrotask(() => {
      if (!destroyed && source === changed) sourceChanged();
    });
  };
  const sourceDestroyed = () => {
    source?.source.off("update", queueSourceChange);
    source?.source.off("resize", queueSourceChange);
    source?.source.off("destroy", sourceDestroyed);
    source?.off("destroy", sourceDestroyed);
    source = null;
    sourceChanged();
  };
  return {
    shader,
    uniforms: group.uniforms,
    geometry: resources.geometry,
    textures,
    get artWindowCount() {
      return (opticalLease?.artWindows ?? artWindows).length;
    },
    setLighting(mode, actualNormal) {
      const lighting = mode === "studio" ? 1 : 0;
      const normal = group.uniforms.cardNormal;
      if (
        group.uniforms.studioLighting === lighting &&
        normal.every((value, index) => value === Math.fround(actualNormal[index]))
      )
        return;
      group.uniforms.studioLighting = lighting;
      normal.set(actualNormal);
      invalidate();
    },
    setTexture(texture: Texture | null, uvs?: Float32Array) {
      if (texture !== source) {
        source?.source.off("update", queueSourceChange);
        source?.source.off("resize", queueSourceChange);
        source?.source.off("destroy", sourceDestroyed);
        source?.off("destroy", sourceDestroyed);
        source = texture;
        source?.source.on("update", queueSourceChange);
        source?.source.on("resize", queueSourceChange);
        source?.source.once("destroy", sourceDestroyed);
        source?.once("destroy", sourceDestroyed);
        motion.clear();
        sourceChanged();
      }
      const uv = texture?.uvs;
      const top = group.uniforms.uUvTop;
      const bottom = group.uniforms.uUvBottom;
      top[0] = uvs?.[0] ?? uv?.x0 ?? 0;
      top[1] = uvs?.[1] ?? uv?.y0 ?? 0;
      top[2] = uvs?.[2] ?? uv?.x1 ?? 1;
      top[3] = uvs?.[3] ?? uv?.y1 ?? 0;
      bottom[0] = uvs?.[6] ?? uv?.x3 ?? 0;
      bottom[1] = uvs?.[7] ?? uv?.y3 ?? 1;
      bottom[2] = uvs?.[4] ?? uv?.x2 ?? 1;
      bottom[3] = uvs?.[5] ?? uv?.y2 ?? 1;
      if (!texture && poolLease) {
        shader.resources.caustics = Texture.EMPTY.source;
        poolLease.release();
        poolLease = null;
      }
      if (mode === "pool" && texture && !poolLease) {
        poolLease = acquireCardFinishCaustics();
        shader.resources.caustics = poolLease.texture.source;
      }
    },
    setMode(value: CardFinish, appearance?: CardCosmetics) {
      if (mode !== value) motion.clear();
      mode = value;
      cosmetics = appearance;
      group.uniforms.regularPrinting = mode === "regular" ? 1 : 0;
      group.uniforms.cardstockAmount = mode === "regular" ? 0 : (cosmetics?.cardstock?.amount ?? 0);
      syncCardstock();
      group.uniforms.previewKind = CARD_FINISH_KINDS[mode];
      group.uniforms.rainFogDensity = resolveCardRainFog(cosmetics);
      group.uniforms.heatDeformation = mode === "heat" ? (cosmetics?.heatDeformation ?? 0) : 0;
      group.uniforms.wearInfo[0] = resolveCardWearAmount(cosmetics);
      group.uniforms.wearInfo[1] = surfaceSeed(cosmetics?.wearSeed ?? 0);
      group.uniforms.surfaceInfo[2] = surfaceSeed(cosmetics?.wearSeed ?? 0);
      if (mode !== "pool" && poolLease) {
        shader.resources.caustics = Texture.EMPTY.source;
        poolLease.release();
        poolLease = null;
      }
      if (mode === "pool" && source && !poolLease) {
        poolLease = acquireCardFinishCaustics();
        shader.resources.caustics = poolLease.texture.source;
      }
      syncMaterial();
    },
    setArtWindows(regions: readonly CardFoilRegion[]) {
      if (artWindows === regions) return;
      artWindows = regions;
      if (!opticalLease) setArtWindows(regions);
      syncMaterial();
    },
    setExclusions(regions: readonly CardFoilRegion[]) {
      if (regions.length > MAX_CARD_FOIL_EXCLUSIONS)
        throw new RangeError(`Card foil supports at most ${MAX_CARD_FOIL_EXCLUSIONS} exclusions`);
      const exclusions = group.uniforms.uExclusions;
      for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        const offset = index * 4;
        exclusions[offset] = region.x;
        exclusions[offset + 1] = region.y;
        exclusions[offset + 2] = region.width;
        exclusions[offset + 3] = region.height;
      }
      group.uniforms.uExclusionCount = regions.length;
    },
    update(time: number, hovering: boolean) {
      time = Math.floor(time * 30) / 30;
      const uniforms = group.uniforms;
      uniforms.surfaceTime = time;
      if (uniforms.studioLighting > 0.5) {
        normal[0] = uniforms.cardNormal[0];
        normal[1] = uniforms.cardNormal[1];
        normal[2] = uniforms.cardNormal[2];
      } else {
        normal[0] = (uniforms.pointer[0] - 0.5) * 0.24;
        normal[1] = (uniforms.pointer[1] - 0.5) * -0.24;
        const length = Math.hypot(normal[0], normal[1], 1);
        normal[0] /= length;
        normal[1] /= length;
        normal[2] = 1 / length;
      }
      const { uUvTop: top, uUvBottom: bottom, pointer } = uniforms;
      const x = pointer[0];
      const y = pointer[1];
      for (let axis = 0; axis < 2; axis++) {
        const upper = top[axis] + (top[axis + 2] - top[axis]) * x;
        const lower = bottom[axis] + (bottom[axis + 2] - bottom[axis]) * x;
        hoverUv[axis] = upper + (lower - upper) * y;
      }
      motion.begin();
      const sample = motion.sample(
        { id: 0, card: 0, transform: identity, normal, finish: mode },
        {
          viewProjection,
          time,
          hover: hovering ? { instance: 0, uv: hoverUv } : undefined,
        },
      );
      motion.end();
      if (sample) {
        uniforms.surfaceInfo[0] = sample[0];
        uniforms.surfaceInfo[1] = sample[1];
        uniforms.ripple0.set(sample.subarray(4, 8));
        uniforms.ripple1.set(sample.subarray(8, 12));
        uniforms.ripple2.set(sample.subarray(12, 16));
        uniforms.ripple3.set(sample.subarray(16, 20));
      }
      if (mode === "pool" && source) {
        if (!poolLease) return;
        poolLease.update(time);
        shader.resources.caustics = poolLease.texture.source;
      }
    },
    destroy() {
      destroyed = true;
      sourceDestroyed();
      releaseMaterial();
      controller?.abort();
      bindTexture("face", Texture.EMPTY);
      bindTexture("mask", Texture.EMPTY);
      shader.resources.caustics = Texture.EMPTY.source;
      maskLease?.release();
      poolLease?.release();
      shader.resources.cardstockMap = Texture.EMPTY.source;
      cardstockLease?.release();
      motion.clear();
      shader.destroy(false);
      if (--resources.users === 0) {
        resources.geometry.destroy();
        shared = null;
      }
    },
  };
}
