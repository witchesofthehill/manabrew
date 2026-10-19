import { Container, Texture, WebGLRenderer } from "pixi.js";
import { CardFoilMesh, getCardFoilBatchStats } from "@/pixi/effects/cardFoilBatch";
import {
  DEFAULT_CARD_POSE,
  writeCardPoseNormal,
  type CardLightingMode,
  type CardPose,
} from "@/lib/cardLighting";
import { createCardFoilShader, type CardFoilShader } from "@/pixi/effects/cardFoilShader";
import type { CardFoilRegion } from "@/lib/cardFinish";
import type { CardCosmetics, CardFinish } from "@/protocol/deck";
import { getCardGpuTimingStats } from "@/lib/cardRenderGpuTiming";

export type CardFoilSource = HTMLCanvasElement | HTMLImageElement;

export interface DomCardFoilOptions {
  source?: CardFoilSource | null;
  mode: CardFinish;
  cosmetics?: CardCosmetics;
  animated: boolean;
  artWindows?: readonly CardFoilRegion[];
  lighting?: CardLightingMode;
  pose?: CardPose;
}

export interface DomCardFoilRegistration {
  update(options: DomCardFoilOptions): void;
  dispose(): void;
}

interface FoilEntry {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  host: HTMLElement;
  options: DomCardFoilOptions;
  source: CardFoilSource | null;
  texture: Texture | null;
  finish: CardFoilShader;
  revision: string;
  dirty: boolean;
  uploadDirty: boolean;
  visible: boolean;
  hovering: boolean;
  pointer: Float32Array;
  uvs: Float32Array;
  clip: Float32Array;
  paddingX: number;
  paddingY: number;
  resolution: number;
  canvasStyle: { property: string; value: string; priority: string }[];
  sourceUploadPending: boolean;
  normal: Float32Array;
  hiddenSource: CardFoilSource | null;
  sourceOpacity: string;
  sourceOpacityPriority: string;
}

interface FoilRenderer {
  renderer: WebGLRenderer;
  stage: Container;
  finish: CardFoilShader;
  mesh: CardFoilMesh;
  contextLost: boolean;
}

const entries = new Set<FoilEntry>();
let shared: FoilRenderer | null = null;
let starting: Promise<void> | null = null;
let frame = 0;
let lastFrame = 0;
const FRAME_INTERVAL = 1000 / 30;
const MAX_FOIL_RESOLUTION = 2;
const NO_ART_WINDOWS: readonly CardFoilRegion[] = [];
const MAX_FOIL_EDGE = 1024;
const domStats = {
  renders: 0,
  outputCopies: 0,
  sourceUploads: 0,
  sourceUploadBytes: 0,
  cpuSubmissionMs: 0,
  restores: 0,
};
export function getDomCardFoilStats() {
  const gpuTiming = getCardGpuTimingStats("dom");
  return {
    ...domStats,
    outputs: entries.size,
    draws: getCardFoilBatchStats().domDraws,
    gpuTiming,
    gpuTimingAvailable: gpuTiming.gpuTimingAvailable,
    gpuCompletionMs: gpuTiming.gpuCompletionMs,
  };
}
function contextLost(event?: Event) {
  event?.preventDefault();
  if (shared) shared.contextLost = true;
  cancelAnimationFrame(frame);
  frame = 0;
  for (const entry of entries) {
    restoreSource(entry);
    entry.context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
    entry.canvas.dataset.foilState = "unavailable";
    entry.dirty = true;
  }
}

function contextRestored() {
  if (!shared || shared.renderer.gl.isContextLost()) return;
  shared.contextLost = false;
  domStats.restores++;
  for (const entry of entries) entry.sourceUploadPending = !!entry.texture;
  visibilityChanged();
}

function disposeRenderer() {
  if (!shared) return;
  shared.stage.destroy({ children: true });
  shared.finish.destroy();
  shared.renderer.canvas.removeEventListener("webglcontextlost", contextLost);
  shared.renderer.canvas.removeEventListener("webglcontextrestored", contextRestored);
  shared.renderer.destroy();
  shared = null;
}

function restoreSource(entry: FoilEntry) {
  if (!entry.hiddenSource) return;
  if (entry.sourceOpacity)
    entry.hiddenSource.style.setProperty(
      "opacity",
      entry.sourceOpacity,
      entry.sourceOpacityPriority,
    );
  else entry.hiddenSource.style.removeProperty("opacity");
  entry.hiddenSource = null;
}

function releaseTexture(entry: FoilEntry) {
  restoreSource(entry);
  if (!entry.texture) return;
  entry.finish.setTexture(null);
  entry.texture.destroy(true);
  entry.texture = null;
}

function requestFrame() {
  if (!frame && entries.size && !document.hidden && !shared?.contextLost)
    frame = requestAnimationFrame(renderFrame);
}

function visibilityChanged() {
  if (document.hidden) {
    cancelAnimationFrame(frame);
    frame = 0;
  } else {
    for (const entry of entries) entry.dirty = true;
    requestFrame();
  }
}

function ensureRenderer() {
  if (shared || starting) return;
  const renderer = new WebGLRenderer();
  starting = renderer
    .init({ width: 1, height: 1, backgroundAlpha: 0, antialias: false, resolution: 1 })
    .then(() => {
      const finish = createCardFoilShader(requestFrame);
      const mesh = new CardFoilMesh(finish, "dom");
      const stage = new Container();
      stage.addChild(mesh);
      shared = { renderer, finish, mesh, stage, contextLost: renderer.gl.isContextLost() };
      renderer.canvas.addEventListener("webglcontextlost", contextLost);
      renderer.canvas.addEventListener("webglcontextrestored", contextRestored);
      if (!entries.size) disposeRenderer();
      else if (shared.contextLost) contextLost();
      else requestFrame();
    })
    .catch((error: unknown) => {
      if (shared?.renderer === renderer) disposeRenderer();
      else if (renderer.gl) renderer.destroy();
      console.error("Card Glint foil renderer could not initialize", error);
      for (const entry of entries) entry.canvas.dataset.foilState = "unavailable";
    })
    .finally(() => {
      starting = null;
    });
}

function displayedSource(entry: FoilEntry): CardFoilSource | null {
  if (entry.options.source) return entry.options.source;
  const candidates = entry.host.querySelectorAll<HTMLImageElement | HTMLCanvasElement>(
    "img,canvas",
  );
  let result: CardFoilSource | null = null;
  let largestArea = 0;
  for (const source of candidates) {
    if (source.dataset.cardFinish || source.closest("[data-card-finish]")) continue;
    if (
      !source.checkVisibility({
        checkOpacity: source !== entry.hiddenSource,
        checkVisibilityCSS: true,
      })
    )
      continue;
    if (source instanceof HTMLImageElement && (!source.complete || !source.naturalWidth)) continue;
    const area = source.clientWidth * source.clientHeight;
    if (!area || area < largestArea) continue;
    largestArea = area;
    result = source;
  }
  return result;
}

function updateSource(entry: FoilEntry) {
  const source = displayedSource(entry);
  const revision =
    source instanceof HTMLImageElement
      ? source.currentSrc
      : source
        ? `${source.width}:${source.height}`
        : "";
  if (entry.source !== source || entry.revision !== revision || !entry.texture) {
    releaseTexture(entry);
    entry.source = source;
    entry.revision = revision;
    if (
      source &&
      (!(source instanceof HTMLImageElement) || (source.complete && source.naturalWidth))
    ) {
      entry.texture = Texture.from(source, true);
      entry.sourceUploadPending = true;
    }
  }
  if (entry.uploadDirty && source instanceof HTMLCanvasElement) {
    entry.finish.setTexture(null);
    entry.texture?.source.update();
    entry.sourceUploadPending = true;
  }
  entry.uploadDirty = false;
  return source;
}

function updateUvs(
  entry: FoilEntry,
  source: CardFoilSource,
  width: number,
  height: number,
  resolution: number,
) {
  const hostRect = entry.canvas.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const style = getComputedStyle(source);
  const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
  const angle = Math.atan2(matrix.b, matrix.a) + ((parseFloat(style.rotate) || 0) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const scaleX = hostRect.width / (width + entry.paddingX * 2);
  const scaleY = hostRect.height / (height + entry.paddingY * 2);
  const hostLeft = hostRect.left + entry.paddingX * scaleX;
  const hostTop = hostRect.top + entry.paddingY * scaleY;
  const centerX = (sourceRect.left + sourceRect.width / 2 - hostLeft) / scaleX;
  const centerY = (sourceRect.top + sourceRect.height / 2 - hostTop) / scaleY;
  const boxWidth = source.clientWidth;
  const boxHeight = source.clientHeight;
  const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  let drawWidth = boxWidth;
  let drawHeight = boxHeight;
  if (
    style.objectFit === "contain" ||
    style.objectFit === "cover" ||
    style.objectFit === "scale-down" ||
    style.objectFit === "none"
  ) {
    const fit =
      style.objectFit === "cover"
        ? Math.max(boxWidth / naturalWidth, boxHeight / naturalHeight)
        : style.objectFit === "none"
          ? 1
          : Math.min(
              boxWidth / naturalWidth,
              boxHeight / naturalHeight,
              style.objectFit === "scale-down" ? 1 : Infinity,
            );
    drawWidth = naturalWidth * fit;
    drawHeight = naturalHeight * fit;
  }
  const position = style.objectPosition.split(" ");
  const positionX = position[0]?.endsWith("%") ? parseFloat(position[0]) / 100 : 0.5;
  const positionY = position[1]?.endsWith("%") ? parseFloat(position[1]) / 100 : 0.5;
  const offsetX = (boxWidth - drawWidth) * positionX;
  const offsetY = (boxHeight - drawHeight) * positionY;
  for (let index = 0; index < 4; index++) {
    const x = (index === 1 || index === 2 ? width : 0) - centerX;
    const y = (index >= 2 ? height : 0) - centerY;
    entry.uvs[index * 2] = (x * cosine + y * sine + boxWidth / 2 - offsetX) / drawWidth;
    entry.uvs[index * 2 + 1] = (-x * sine + y * cosine + boxHeight / 2 - offsetY) / drawHeight;
  }
  const uvs = entry.uvs;
  const duX = uvs[2] - uvs[0];
  const duY = uvs[3] - uvs[1];
  const dvX = uvs[6] - uvs[0];
  const dvY = uvs[7] - uvs[1];
  const fullCard =
    Math.abs(Math.abs(duX) + Math.abs(dvX) - 1) < 0.00001 &&
    Math.abs(Math.abs(duY) + Math.abs(dvY) - 1) < 0.00001 &&
    Math.abs(Math.min(uvs[0], uvs[2], uvs[4], uvs[6])) < 0.00001 &&
    Math.abs(Math.min(uvs[1], uvs[3], uvs[5], uvs[7])) < 0.00001;
  const amount = fullCard ? entry.finish.uniforms.heatDeformation : 0;
  const determinant = Math.abs(duX * dvY - dvX * duY);
  const paddingX =
    amount > 0
      ? Math.ceil(
          (amount * (Math.abs(dvY) + Math.abs(dvX) * 0.18) * Math.round(width * resolution)) /
            determinant,
        ) / resolution
      : 0;
  const paddingY =
    amount > 0
      ? Math.ceil(
          (amount * (Math.abs(duY) + Math.abs(duX) * 0.18) * Math.round(height * resolution)) /
            determinant,
        ) / resolution
      : 0;
  const clip = entry.clip;
  clip[0] = Math.max(-paddingX, (sourceRect.left - hostLeft) / scaleX - paddingX);
  clip[1] = Math.max(-paddingY, (sourceRect.top - hostTop) / scaleY - paddingY);
  clip[2] = Math.min(width + paddingX, (sourceRect.right - hostLeft) / scaleX + paddingX);
  clip[3] = Math.min(height + paddingY, (sourceRect.bottom - hostTop) / scaleY + paddingY);
  for (
    let ancestor = source.parentElement;
    ancestor && ancestor !== entry.host;
    ancestor = ancestor.parentElement
  ) {
    const ancestorStyle = getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    if (ancestorStyle.overflowX !== "visible") {
      clip[0] = Math.max(clip[0], (bounds.left - hostLeft) / scaleX);
      clip[2] = Math.min(clip[2], (bounds.right - hostLeft) / scaleX);
    }
    if (ancestorStyle.overflowY !== "visible") {
      clip[1] = Math.max(clip[1], (bounds.top - hostTop) / scaleY);
      clip[3] = Math.min(clip[3], (bounds.bottom - hostTop) / scaleY);
    }
  }
  if (entry.paddingX !== paddingX || entry.paddingY !== paddingY) {
    if (paddingX || paddingY) {
      entry.canvas.style.width = `calc(100% + ${paddingX * 2}px)`;
      entry.canvas.style.height = `calc(100% + ${paddingY * 2}px)`;
      entry.canvas.style.left = `${-paddingX}px`;
      entry.canvas.style.top = `${-paddingY}px`;
      entry.canvas.style.borderRadius = "0";
    } else {
      for (const { property, value, priority } of entry.canvasStyle)
        if (value) entry.canvas.style.setProperty(property, value, priority);
        else entry.canvas.style.removeProperty(property);
    }
    entry.paddingX = paddingX;
    entry.paddingY = paddingY;
  }
  entry.resolution = resolution;
}

function renderFrame(now: number) {
  frame = 0;
  if (!shared || document.hidden || shared.contextLost) return;
  if (shared.renderer.gl.isContextLost()) {
    contextLost();
    return;
  }
  if (now - lastFrame < FRAME_INTERVAL) {
    requestFrame();
    return;
  }
  lastFrame = now;
  let animate = false;
  const { renderer, mesh, stage } = shared;
  for (const entry of entries) {
    if (!entry.visible) continue;
    const finish = entry.finish;
    const animated = entry.options.animated;
    if (!entry.dirty && !animated) continue;
    const source = entry.dirty ? updateSource(entry) : entry.source;
    if (!source || !entry.texture) {
      entry.context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
      entry.dirty = false;
      continue;
    }
    const width = entry.host.clientWidth;
    const height = entry.host.clientHeight;
    if (
      !width ||
      !height ||
      !entry.host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      continue;
    const resolution = Math.min(
      window.devicePixelRatio || 1,
      MAX_FOIL_RESOLUTION,
      MAX_FOIL_EDGE / Math.max(width, height),
    );
    const pixelWidth = Math.max(1, Math.round(width * resolution));
    const pixelHeight = Math.max(1, Math.round(height * resolution));
    if (entry.dirty || entry.resolution !== resolution)
      updateUvs(entry, source, width, height, resolution);
    const originX = Math.round(entry.paddingX * resolution);
    const originY = Math.round(entry.paddingY * resolution);
    const outputWidth = pixelWidth + originX * 2;
    const outputHeight = pixelHeight + originY * 2;
    if (entry.canvas.width !== outputWidth || entry.canvas.height !== outputHeight) {
      entry.canvas.width = outputWidth;
      entry.canvas.height = outputHeight;
    }
    finish.setTexture(entry.texture, entry.uvs);
    mesh.shader = finish.shader;
    mesh.finish = finish;
    finish.uniforms.uSize[0] = width;
    finish.uniforms.uSize[1] = height;
    finish.uniforms.uRadius = 0;
    if (!animated) finish.uniforms.pointer.fill(0.5);
    else if (entry.hovering) finish.uniforms.pointer.set(entry.pointer);
    else {
      const phase = (now * Math.PI * 2) / 6400;
      finish.uniforms.pointer[0] = 0.5 + Math.sin(phase) * 0.18;
      finish.uniforms.pointer[1] = 0.5 + Math.sin(phase * 2) * 0.12;
    }
    mesh.scale.set(pixelWidth, pixelHeight);
    mesh.position.set(originX, originY);
    if (renderer.width < outputWidth || renderer.height < outputHeight) {
      renderer.resize(
        Math.max(renderer.width, outputWidth),
        Math.max(renderer.height, outputHeight),
      );
    }
    try {
      finish.update(animated ? now / 1000 : 0, animated && entry.hovering);
      renderer.gl.pixelStorei(renderer.gl.UNPACK_ALIGNMENT, 1);
      const started = performance.now();
      renderer.render(stage);
      if (shared.contextLost || renderer.gl.isContextLost()) {
        contextLost();
        return;
      }
      domStats.cpuSubmissionMs += performance.now() - started;
      domStats.renders++;
      if (entry.sourceUploadPending) {
        domStats.sourceUploads++;
        domStats.sourceUploadBytes +=
          entry.texture.source.pixelWidth * entry.texture.source.pixelHeight * 4;
        entry.sourceUploadPending = false;
      }
      entry.context.clearRect(0, 0, outputWidth, outputHeight);
      const x = Math.max(0, originX + entry.clip[0] * resolution);
      const y = Math.max(0, originY + entry.clip[1] * resolution);
      const clippedWidth = Math.min(outputWidth, originX + entry.clip[2] * resolution) - x;
      const clippedHeight = Math.min(outputHeight, originY + entry.clip[3] * resolution) - y;
      if (clippedWidth > 0 && clippedHeight > 0) {
        entry.context.drawImage(
          renderer.canvas,
          x,
          y,
          clippedWidth,
          clippedHeight,
          x,
          y,
          clippedWidth,
          clippedHeight,
        );
        domStats.outputCopies++;
      }
      entry.canvas.dataset.foilState =
        clippedWidth > 0 && clippedHeight > 0 ? "ready" : "unavailable";
      if (finish.uniforms.heatDeformation > 0 && clippedWidth > 0 && clippedHeight > 0) {
        if (entry.hiddenSource !== source) {
          restoreSource(entry);
          entry.hiddenSource = source;
          entry.sourceOpacity = source.style.getPropertyValue("opacity");
          entry.sourceOpacityPriority = source.style.getPropertyPriority("opacity");
          source.style.setProperty("opacity", "0");
        }
      } else restoreSource(entry);
    } catch (error) {
      if (renderer.gl.isContextLost()) {
        contextLost();
        return;
      }
      entry.context.clearRect(0, 0, outputWidth, outputHeight);
      entry.canvas.dataset.foilState = "unavailable";
      console.error("Card Glint foil could not render the displayed face", error);
      releaseTexture(entry);
    }
    entry.dirty = false;
    animate ||= animated && !!entry.texture;
  }
  if (animate) requestFrame();
}

export function registerDomCardFoil(
  canvas: HTMLCanvasElement,
  options: DomCardFoilOptions,
): DomCardFoilRegistration {
  const host = canvas.parentElement;
  const context = canvas.getContext("2d");
  if (!host || !context) return { update() {}, dispose() {} };
  const entry: FoilEntry = {
    canvas,
    context,
    host,
    options,
    source: null,
    texture: null,
    finish: createCardFoilShader(() => {
      entry.dirty = true;
      requestFrame();
    }),
    revision: "",
    dirty: true,
    uploadDirty: false,
    visible: false,
    hovering: false,
    pointer: new Float32Array([0.5, 0.5]),
    uvs: new Float32Array(8),
    clip: new Float32Array(4),
    paddingX: 0,
    paddingY: 0,
    resolution: 0,
    canvasStyle: ["width", "height", "left", "top", "border-radius"].map((property) => ({
      property,
      value: canvas.style.getPropertyValue(property),
      priority: canvas.style.getPropertyPriority(property),
    })),
    sourceUploadPending: false,
    normal: new Float32Array([0, 0, 1]),
    hiddenSource: null,
    sourceOpacity: "",
    sourceOpacityPriority: "",
  };
  entry.finish.setMode(options.mode, options.cosmetics);
  entry.finish.setArtWindows(options.artWindows ?? NO_ART_WINDOWS);
  writeCardPoseNormal(entry.normal, options.pose ?? DEFAULT_CARD_POSE);
  entry.finish.setLighting(options.lighting ?? "pointer", entry.normal);
  const invalidate = () => {
    entry.dirty = true;
    requestFrame();
  };
  const intersection = new IntersectionObserver(([intersectionEntry]) => {
    entry.visible = intersectionEntry.isIntersecting;
    if (!entry.visible) {
      releaseTexture(entry);
      entry.source = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    }
    invalidate();
  });
  const resize = new ResizeObserver(invalidate);
  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target === entry.source &&
          (record.attributeName === "width" || record.attributeName === "height"),
      )
    )
      entry.uploadDirty = true;
    if (records.some((record) => record.target !== canvas)) invalidate();
  });
  const pointer = (event: PointerEvent) => {
    if (!entry.options.animated) return;
    const rect = canvas.getBoundingClientRect();
    const width = host.clientWidth;
    const height = host.clientHeight;
    const scaleX = rect.width / (width + entry.paddingX * 2);
    const scaleY = rect.height / (height + entry.paddingY * 2);
    entry.hovering = true;
    entry.pointer[0] = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left - entry.paddingX * scaleX) / (width * scaleX)),
    );
    entry.pointer[1] = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top - entry.paddingY * scaleY) / (height * scaleY)),
    );
    invalidate();
  };
  const leave = () => {
    entry.hovering = false;
    invalidate();
  };
  intersection.observe(canvas);
  resize.observe(host);
  mutations.observe(host, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "class", "style", "width", "height"],
  });
  for (let ancestor = host.parentElement; ancestor; ancestor = ancestor.parentElement) {
    mutations.observe(ancestor, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  }
  host.addEventListener("load", invalidate, true);
  host.addEventListener("pointermove", pointer, { passive: true });
  host.addEventListener("pointerleave", leave, { passive: true });
  if (!entries.size) document.addEventListener("visibilitychange", visibilityChanged);
  entries.add(entry);
  if (shared?.contextLost) canvas.dataset.foilState = "unavailable";
  ensureRenderer();
  requestFrame();
  return {
    update(next) {
      const previous = entry.options;
      entry.options = next;
      if (previous.mode !== next.mode || previous.cosmetics !== next.cosmetics)
        entry.finish.setMode(next.mode, next.cosmetics);
      if (previous.artWindows !== next.artWindows)
        entry.finish.setArtWindows(next.artWindows ?? NO_ART_WINDOWS);
      writeCardPoseNormal(entry.normal, next.pose ?? DEFAULT_CARD_POSE);
      entry.finish.setLighting(next.lighting ?? "pointer", entry.normal);
      invalidate();
    },
    dispose() {
      entries.delete(entry);
      intersection.disconnect();
      resize.disconnect();
      mutations.disconnect();
      host.removeEventListener("load", invalidate, true);
      host.removeEventListener("pointermove", pointer);
      host.removeEventListener("pointerleave", leave);
      releaseTexture(entry);
      if (shared?.mesh.shader === entry.finish.shader) shared.mesh.shader = shared.finish.shader;
      if (shared?.mesh.finish === entry.finish) shared.mesh.finish = shared.finish;
      entry.finish.destroy();
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
      for (const { property, value, priority } of entry.canvasStyle)
        if (value) canvas.style.setProperty(property, value, priority);
        else canvas.style.removeProperty(property);
      if (!entries.size) {
        cancelAnimationFrame(frame);
        frame = 0;
        document.removeEventListener("visibilitychange", visibilityChanged);
        disposeRenderer();
      }
    },
  };
}
