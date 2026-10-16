import { Container, Mesh, Texture, WebGLRenderer, type MeshGeometry, type Shader } from "pixi.js";
import { createCardFoilShader, type CardFoilShader } from "@/pixi/effects/cardFoilShader";
import type { CardFoilRegion } from "@/lib/cardFinish";
import type { CardCosmetics, CardFinish } from "@/protocol/deck";

export type CardFoilSource = HTMLCanvasElement | HTMLImageElement;

export interface DomCardFoilOptions {
  source?: CardFoilSource | null;
  mode: CardFinish;
  cosmetics?: CardCosmetics;
  animated: boolean;
  artWindows?: readonly CardFoilRegion[];
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
}

interface FoilRenderer {
  renderer: WebGLRenderer;
  stage: Container;
  finish: CardFoilShader;
  mesh: Mesh<MeshGeometry, Shader>;
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

function disposeRenderer() {
  if (!shared) return;
  shared.stage.destroy({ children: true });
  shared.finish.destroy();
  shared.renderer.canvas.removeEventListener("webglcontextrestored", visibilityChanged);
  shared.renderer.destroy();
  shared = null;
}

function releaseTexture(entry: FoilEntry) {
  if (!entry.texture) return;
  entry.finish.setTexture(null);
  entry.texture.destroy(true);
  entry.texture = null;
}

function requestFrame() {
  if (!frame && entries.size && !document.hidden) frame = requestAnimationFrame(renderFrame);
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
      const mesh = new Mesh({ geometry: finish.geometry, shader: finish.shader });
      const stage = new Container();
      stage.addChild(mesh);
      shared = { renderer, finish, mesh, stage };
      renderer.canvas.addEventListener("webglcontextrestored", visibilityChanged);
      if (!entries.size) disposeRenderer();
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
    if (!source.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
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
    }
  }
  if (entry.uploadDirty && source instanceof HTMLCanvasElement) {
    entry.finish.setTexture(null);
    entry.texture?.source.update();
  }
  entry.uploadDirty = false;
  return source;
}

function updateUvs(entry: FoilEntry, source: CardFoilSource, width: number, height: number) {
  const hostRect = entry.canvas.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const style = getComputedStyle(source);
  const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);
  const angle = Math.atan2(matrix.b, matrix.a) + ((parseFloat(style.rotate) || 0) * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const scaleX = hostRect.width / width;
  const scaleY = hostRect.height / height;
  const clip = entry.clip;
  clip[0] = Math.max(0, (sourceRect.left - hostRect.left) / scaleX);
  clip[1] = Math.max(0, (sourceRect.top - hostRect.top) / scaleY);
  clip[2] = Math.min(width, (sourceRect.right - hostRect.left) / scaleX);
  clip[3] = Math.min(height, (sourceRect.bottom - hostRect.top) / scaleY);
  for (
    let ancestor = source.parentElement;
    ancestor && ancestor !== entry.host;
    ancestor = ancestor.parentElement
  ) {
    const ancestorStyle = getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    if (ancestorStyle.overflowX !== "visible") {
      clip[0] = Math.max(clip[0], (bounds.left - hostRect.left) / scaleX);
      clip[2] = Math.min(clip[2], (bounds.right - hostRect.left) / scaleX);
    }
    if (ancestorStyle.overflowY !== "visible") {
      clip[1] = Math.max(clip[1], (bounds.top - hostRect.top) / scaleY);
      clip[3] = Math.min(clip[3], (bounds.bottom - hostRect.top) / scaleY);
    }
  }
  const centerX = (sourceRect.left + sourceRect.width / 2 - hostRect.left) / scaleX;
  const centerY = (sourceRect.top + sourceRect.height / 2 - hostRect.top) / scaleY;
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
}

function renderFrame(now: number) {
  frame = 0;
  if (!shared || document.hidden) return;
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
    const width = entry.canvas.clientWidth;
    const height = entry.canvas.clientHeight;
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
    if (entry.canvas.width !== pixelWidth || entry.canvas.height !== pixelHeight) {
      entry.canvas.width = pixelWidth;
      entry.canvas.height = pixelHeight;
    }
    if (entry.dirty) updateUvs(entry, source, width, height);
    finish.setTexture(entry.texture, entry.uvs);
    finish.setMode(entry.options.mode, entry.options.cosmetics);
    mesh.shader = finish.shader;
    finish.setArtWindows(entry.options.artWindows ?? NO_ART_WINDOWS);
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
    if (renderer.width < pixelWidth || renderer.height < pixelHeight) {
      renderer.resize(Math.max(renderer.width, pixelWidth), Math.max(renderer.height, pixelHeight));
    }
    try {
      finish.update(animated ? now / 1000 : 0, animated && entry.hovering);
      renderer.render(stage);
      entry.context.clearRect(0, 0, pixelWidth, pixelHeight);
      const x = entry.clip[0] * resolution;
      const y = entry.clip[1] * resolution;
      const clippedWidth = (entry.clip[2] - entry.clip[0]) * resolution;
      const clippedHeight = (entry.clip[3] - entry.clip[1]) * resolution;
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
      }
      entry.canvas.dataset.foilState = "ready";
    } catch (error) {
      entry.context.clearRect(0, 0, pixelWidth, pixelHeight);
      entry.canvas.dataset.foilState = "unavailable";
      console.error("Card Glint foil could not render the displayed face", error);
      releaseTexture(entry);
    }
    entry.dirty = false;
    animate ||= animated && !!entry.texture;
  }
  if (animate) requestFrame();
}

export function registerDomCardFoil(canvas: HTMLCanvasElement, options: DomCardFoilOptions) {
  const host = canvas.parentElement;
  const context = canvas.getContext("2d");
  if (!host || !context) return () => {};
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
  };
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
    if (!options.animated) return;
    const rect = canvas.getBoundingClientRect();
    entry.hovering = true;
    entry.pointer[0] = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    entry.pointer[1] = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
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
  ensureRenderer();
  requestFrame();
  return () => {
    entries.delete(entry);
    intersection.disconnect();
    resize.disconnect();
    mutations.disconnect();
    host.removeEventListener("load", invalidate, true);
    host.removeEventListener("pointermove", pointer);
    host.removeEventListener("pointerleave", leave);
    releaseTexture(entry);
    if (shared?.mesh.shader === entry.finish.shader) shared.mesh.shader = shared.finish.shader;
    entry.finish.destroy();
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 1;
    canvas.height = 1;
    if (!entries.size) {
      cancelAnimationFrame(frame);
      frame = 0;
      document.removeEventListener("visibilitychange", visibilityChanged);
      disposeRenderer();
    }
  };
}
