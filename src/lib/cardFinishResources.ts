import { DEFAULT_PRINT_DOTS, FinishResources, FinishTextures } from "card-glint/finish";
import type { CardDocument } from "card-glint";
import { BufferImageSource, CanvasSource, Texture, TextureSource } from "pixi.js";
import type { WebGLRenderer } from "pixi.js";
import { ensureCardGlintFonts } from "@/lib/cardGlintAssets";
import { getCardFinishSource } from "@/lib/cardOpticalLayers";
import type { CardFinishSource } from "@/lib/cardOpticalLayers";
import { cardFinishCoverageDocument } from "@/lib/cardGlintInspectAppearance";
import type { CardCosmetics } from "@/protocol/deck";
import type { CardFoilRegion } from "@/lib/cardFinish";

export interface CardFinishMaskLease {
  texture: Texture;
  release(): void;
}

export interface CardFinishPrintingLease {
  texture: Texture | null;
  procedural: boolean;
  release(): void;
}

export interface CardFinishCausticsLease extends CardFinishMaskLease {
  update(time: number): void;
}

type ArtworkSource = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageBitmap;
type ArtworkResource = ArtworkSource | TextureSource;

interface ArtworkMasks {
  resource: ArtworkResource;
  revision: number;
  sources: Map<TextureSource, () => void>;
  entries: Map<string, MaskEntry>;
  overflow: Set<string>;
}

interface MaskEntry {
  artwork: ArtworkMasks;
  key: string;
  revision: number;
  generation: number;
  imageUrl: string;
  width: number;
  height: number;
  bytes: number;
  refs: number;
  texture: Texture | null;
  canvas: HTMLCanvasElement | null;
  ready: Promise<Texture>;
  disposed: boolean;
  controller: AbortController;
  native: CardFinishSource | null;
  kind: "mask" | "coverage" | "printing";
  source: TextureSource;
  printDots?: CardCosmetics["printDots"];
  artWindows: readonly CardFoilRegion[];
  reservedBytes: number;
}

interface CausticsEntry {
  texture: Texture;
  refs: number;
  time: number;
}

const MAX_MASK_EDGE = 1024;
const MAX_IDLE_MASKS = 24;
const MAX_IDLE_MASK_BYTES = 32 * 1024 * 1024;
const MASK_BYTES_PER_PIXEL = 4;
const MAX_PRINTING_BYTES = 32 * 1024 * 1024;
const liveMasks = new Set<MaskEntry>();
let printingBytes = 0;
const preparationStats = {
  hits: 0,
  misses: 0,
  evictions: 0,
  masks: 0,
  coverage: 0,
  printing: 0,
  procedural: 0,
  preparedUploadBytes: 0,
  gpuPreparations: 0,
  gpuCopies: 0,
  gpuCopyBytes: 0,
  gpuResidentBytes: 0,
  gpuBorrowedCardstockBytes: 0,
  gpuHostScratchPeakBytes: 0,
  dynamicUpdates: 0,
};

export function getCardFinishStats() {
  let activeBytes = 0;
  let r8Bytes = 0;
  let retainedBytes = 0;
  for (const entry of liveMasks) {
    retainedBytes += entry.bytes;
    if (entry.refs) activeBytes += entry.bytes;
    if (entry.texture?.source.format === "r8unorm") r8Bytes += entry.bytes;
  }
  return {
    ...preparationStats,
    leases: leaseCount,
    entries: liveMasks.size,
    activeBytes,
    retainedBytes,
    idleBytes: idleMaskBytes,
    r8Bytes,
    printingBytes,
    printingBudget: MAX_PRINTING_BYTES,
  };
}

function mipBytes(width: number, height: number): number {
  let bytes = 0;
  for (;;) {
    bytes += width * height * 4;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  }
}
const artworkMasks = new WeakMap<ArtworkResource, ArtworkMasks>();
const idleMasks = new Set<MaskEntry>();
let idleMaskBytes = 0;
let leaseCount = 0;
let maskGeneration = 0;
let resources: FinishResources | null = null;
let caustics: CausticsEntry | null = null;
let cardstock: { texture: Texture; refs: number } | null = null;
const SDK_REVISION = "0.6.12";

function finishResources(): FinishResources {
  resources ??= new FinishResources();
  return resources;
}

function isArtworkSource(resource: unknown): resource is ArtworkSource {
  return (
    (typeof HTMLCanvasElement !== "undefined" && resource instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== "undefined" && resource instanceof OffscreenCanvas) ||
    (typeof HTMLImageElement !== "undefined" && resource instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== "undefined" && resource instanceof ImageBitmap)
  );
}

function isImage(resource: unknown): resource is HTMLImageElement {
  return typeof HTMLImageElement !== "undefined" && resource instanceof HTMLImageElement;
}

function watchSource(artwork: ArtworkMasks, source: TextureSource): void {
  if (artwork.sources.has(source)) return;
  const update = () => {
    artwork.revision += 1;
    artwork.overflow.clear();
  };
  const detach = () => {
    source.off("update", update);
    source.off("resize", update);
    source.off("destroy", detach);
    artwork.sources.delete(source);
  };
  artwork.sources.set(source, detach);
  source.on("update", update);
  source.on("resize", update);
  source.once("destroy", detach);
}

function removeIdleMask(entry: MaskEntry): void {
  if (idleMasks.delete(entry)) idleMaskBytes -= entry.bytes;
}

function destroyMask(entry: MaskEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  entry.controller.abort();
  liveMasks.delete(entry);
  printingBytes -= entry.reservedBytes;
  entry.reservedBytes = 0;
  preparationStats.evictions++;
  removeIdleMask(entry);
  entry.artwork.entries.delete(entry.key);
  entry.texture?.destroy(true);
  entry.texture = null;
  if (entry.canvas) {
    entry.canvas.width = 1;
    entry.canvas.height = 1;
    entry.canvas = null;
  }
  if (!entry.artwork.entries.size && !entry.artwork.overflow.size) {
    for (const detach of entry.artwork.sources.values()) detach();
    artworkMasks.delete(entry.artwork.resource);
  }
}

function disposeUnusedResources(): void {
  if (leaseCount) return;
  for (const entry of idleMasks) destroyMask(entry);
  resources?.dispose();
  resources = null;
}

function releaseMask(entry: MaskEntry): void {
  entry.refs -= 1;
  leaseCount -= 1;
  if (!entry.refs) {
    if (entry.texture) {
      idleMasks.add(entry);
      idleMaskBytes += entry.bytes;
      while (idleMasks.size > MAX_IDLE_MASKS || idleMaskBytes > MAX_IDLE_MASK_BYTES) {
        const oldest = idleMasks.values().next().value;
        if (!oldest) break;
        destroyMask(oldest);
      }
    } else {
      destroyMask(entry);
    }
  }
  disposeUnusedResources();
}

function canvasTexture(canvas: HTMLCanvasElement, repeat = false): Texture {
  const source = new CanvasSource({
    resource: canvas,
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    format: "rgba8unorm",
    alphaMode: "no-premultiply-alpha",
    scaleMode: "linear",
    addressMode: repeat ? "repeat" : "clamp-to-edge",
    autoGenerateMipmaps: false,
  });
  return new Texture({ source });
}

interface GpuFinish {
  input?: TextureSource;
  settings?: CardCosmetics["printDots"];
  artWindows?: readonly CardFoilRegion[];
}
const gpuFinishes = new WeakMap<TextureSource, GpuFinish>();

function gpuTexture(width: number, height: number, finish: GpuFinish): Texture {
  const source = new TextureSource({
    width,
    height,
    format: finish.input ? "rgba8unorm-srgb" : "rgba8unorm",
    alphaMode: "no-premultiply-alpha",
    autoGenerateMipmaps: true,
    autoGarbageCollect: false,
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressMode: "clamp-to-edge",
  });
  gpuFinishes.set(source, finish);
  return new Texture({ source });
}

export class CardFinishGpuResources {
  private helper: FinishTextures | null = null;
  private prepared = new WeakMap<TextureSource, WebGLTexture>();
  private readonly resident = new Map<TextureSource, () => void>();
  private borrowedBytes = 0;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private readonly lost = () => {
    this.helper?.dispose();
    this.helper = null;
    this.clearAccounting();
    this.prepared = new WeakMap();
    this.program = null;
    this.vao = null;
    this.framebuffer = null;
  };

  private readonly renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  init(): void {
    this.renderer.canvas.addEventListener("webglcontextlost", this.lost);
  }

  prepare(source: TextureSource): boolean {
    const finish = gpuFinishes.get(source);
    if (!finish || source.destroyed) return false;
    const renderer = this.renderer;
    const gl = renderer.gl as WebGL2RenderingContext;
    if (gl.isContextLost()) return false;
    let destination = renderer.texture.getGlSource(source);
    if (this.prepared.get(source) === destination.texture) return false;
    this.helper ??= new FinishTextures(gl);
    if (finish.input) {
      const input = finish.input;
      if (input.destroyed) throw new Error("Cannot prepare printing from a destroyed source");
      this.prepare(input);
      renderer.texture.bindSource(input, 0);
      const original = renderer.texture.getGlSource(input).texture;
      const compatible =
        (gpuFinishes.has(input) || !input.resource) &&
        input.format === "rgba8unorm-srgb" &&
        input.alphaMode === "no-premultiply-alpha";
      const normalized = compatible ? original : this.normalize(input, original);
      preparationStats.gpuHostScratchPeakBytes = Math.max(
        preparationStats.gpuHostScratchPeakBytes,
        mipBytes(source.pixelWidth, source.pixelHeight) +
          (compatible ? 0 : input.pixelWidth * input.pixelHeight * 4),
      );
      try {
        const result = this.helper.printDots(
          { texture: normalized, width: input.pixelWidth, height: input.pixelHeight },
          finish.settings,
          finish.artWindows?.map(({ x, y, width, height }) => [x, y, width, height]),
        );
        gl.deleteTexture(destination.texture);
        destination.texture = result.texture;
        preparationStats.printing++;
      } finally {
        if (!compatible) gl.deleteTexture(normalized);
        renderer.texture.resetState();
      }
    } else {
      const map = this.helper.cardstock();
      if (!this.borrowedBytes) {
        this.borrowedBytes = mipBytes(map.width, map.height);
        preparationStats.gpuBorrowedCardstockBytes += this.borrowedBytes;
      }
      source.resize(map.width, map.height);
      destination = renderer.texture.getGlSource(source);
      renderer.texture.resetState();
      renderer.texture.bindSource(source, 0);
      const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      this.framebuffer ??= gl.createFramebuffer();
      if (!this.framebuffer) throw new Error("Card finish copy framebuffer allocation failed");
      try {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(
          gl.READ_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          map.texture,
          0,
        );
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, map.width, map.height);
        gl.generateMipmap(gl.TEXTURE_2D);
        preparationStats.gpuCopies++;
        preparationStats.gpuCopyBytes += map.width * map.height * 4;
      } finally {
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        renderer.texture.resetState();
      }
    }
    this.resident.get(source)?.();
    const bytes = mipBytes(source.pixelWidth, source.pixelHeight);
    preparationStats.gpuResidentBytes += bytes;
    const release = () => {
      source.off("destroy", release);
      source.off("unload", release);
      this.resident.delete(source);
      this.prepared.delete(source);
      preparationStats.gpuResidentBytes -= bytes;
    };
    source.once("destroy", release);
    source.once("unload", release);
    this.resident.set(source, release);
    this.prepared.set(source, destination.texture);
    preparationStats.gpuPreparations++;
    return true;
  }

  private normalize(source: TextureSource, texture: WebGLTexture): WebGLTexture {
    const gl = this.renderer.gl as WebGL2RenderingContext;
    if (!this.program) {
      const vertex = `#version 300 es
      out vec2 uv;
      void main(){
        vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
        uv=p;gl_Position=vec4(p*2.-1.,0.,1.);
      }`;
      const fragment = `#version 300 es
      precision highp float;
      uniform sampler2D image;
      uniform float premultiplied;
      uniform float linearSource;
      uniform float flipY;
      in vec2 uv;out vec4 color;
      vec3 linearInk(vec3 c){
        return mix(c/12.92,pow(max((c+.055)/1.055,vec3(0.)),vec3(2.4)),step(vec3(.04045),c));
      }
      vec3 encodedInk(vec3 c){
        return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));
      }
      void main(){
        vec4 ink=textureLod(image,vec2(uv.x,mix(uv.y,1.-uv.y,flipY)),0.);
        if(premultiplied>.5){
          if(linearSource>.5)ink.rgb=encodedInk(ink.rgb);
          ink.rgb=linearInk(ink.rgb/max(ink.a,.00001));
        }else if(linearSource<.5)ink.rgb=linearInk(ink.rgb);
        color=ink;
      }`;
      const program = gl.createProgram();
      if (!program) throw new Error("Card finish normalization program allocation failed");
      const shaders: WebGLShader[] = [];
      try {
        for (const [type, code] of [
          [gl.VERTEX_SHADER, vertex],
          [gl.FRAGMENT_SHADER, fragment],
        ] as const) {
          const shader = gl.createShader(type);
          if (!shader) throw new Error("Card finish normalization shader allocation failed");
          shaders.push(shader);
          gl.shaderSource(shader, code);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(
              gl.getShaderInfoLog(shader) ?? "Card finish normalization compile failed",
            );
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program) ?? "Card finish normalization link failed");
        this.program = program;
      } catch (error) {
        gl.deleteProgram(program);
        throw error;
      } finally {
        for (const shader of shaders) gl.deleteShader(shader);
      }
    }
    const output = gl.createTexture();
    this.vao ??= gl.createVertexArray();
    this.framebuffer ??= gl.createFramebuffer();
    if (!output || !this.vao || !this.framebuffer) {
      if (output) gl.deleteTexture(output);
      throw new Error("Card finish normalization allocation failed");
    }
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const mask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
    const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const capabilities = [
      gl.BLEND,
      gl.DEPTH_TEST,
      gl.STENCIL_TEST,
      gl.SCISSOR_TEST,
      gl.CULL_FACE,
      gl.RASTERIZER_DISCARD,
    ];
    const enabled = capabilities.map((capability) => gl.isEnabled(capability));
    gl.activeTexture(gl.TEXTURE0);
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const sampler = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, output);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8, source.pixelWidth, source.pixelHeight);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      for (const capability of capabilities) gl.disable(capability);
      gl.colorMask(true, true, true, true);
      gl.viewport(0, 0, source.pixelWidth, source.pixelHeight);
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindSampler(0, null);
      gl.uniform1i(gl.getUniformLocation(this.program!, "image"), 0);
      gl.uniform1f(
        gl.getUniformLocation(this.program!, "premultiplied"),
        source.alphaMode === "no-premultiply-alpha" ? 0 : 1,
      );
      gl.uniform1f(
        gl.getUniformLocation(this.program!, "linearSource"),
        source.format === "rgba8unorm-srgb" || source.format === "bgra8unorm-srgb" ? 1 : 0,
      );
      gl.uniform1f(gl.getUniformLocation(this.program!, "flipY"), source.resource ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return output;
    } catch (error) {
      gl.deleteTexture(output);
      throw error;
    } finally {
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
      for (let index = 0; index < capabilities.length; index++)
        if (enabled[index]) gl.enable(capabilities[index]);
      gl.bindTexture(gl.TEXTURE_2D, bound);
      gl.bindSampler(0, sampler);
      gl.activeTexture(active);
    }
  }

  private clearAccounting(): void {
    for (const release of this.resident.values()) release();
    preparationStats.gpuBorrowedCardstockBytes -= this.borrowedBytes;
    this.borrowedBytes = 0;
  }

  destroy(): void {
    this.renderer.canvas.removeEventListener("webglcontextlost", this.lost);
    const gl = this.renderer.gl as WebGL2RenderingContext;
    this.helper?.dispose();
    this.clearAccounting();
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    this.helper = null;
    this.program = null;
    this.vao = null;
    this.framebuffer = null;
    this.prepared = new WeakMap();
  }
}

async function createMask(entry: MaskEntry): Promise<Texture> {
  if (entry.disposed || !entry.refs) {
    throw new DOMException("Card finish mask acquisition cancelled", "AbortError");
  }
  const { artwork } = entry;
  const resource = artwork.resource;
  const drawable = resource instanceof TextureSource ? resource.resource : resource;
  const image = isImage(drawable) ? drawable : null;
  const width =
    resource instanceof TextureSource
      ? resource.pixelWidth
      : image
        ? image.naturalWidth
        : resource.width;
  const height =
    resource instanceof TextureSource
      ? resource.pixelHeight
      : image
        ? image.naturalHeight
        : resource.height;
  const url = image ? image.currentSrc || image.src : "";
  if (
    artwork.revision !== entry.revision ||
    width !== entry.width ||
    height !== entry.height ||
    url !== entry.imageUrl
  ) {
    throw new Error("Card artwork changed before its finish mask was generated");
  }
  if (entry.kind === "printing") {
    entry.texture = gpuTexture(width, height, {
      input: entry.source,
      settings: entry.printDots,
      artWindows: entry.artWindows,
    });
    entry.bytes = entry.reservedBytes;
    return entry.texture;
  }
  if (!isArtworkSource(resource))
    throw new Error("Card finish masks require drawable image, bitmap, or canvas artwork");
  if (entry.native) {
    if (entry.kind !== "coverage") await ensureCardGlintFonts();
    entry.controller.signal.throwIfAborted();
    const document =
      entry.native.kind === "raster"
        ? {
            ...entry.native.document,
            recipe: {
              ...entry.native.document.recipe,
              edges: entry.native.document.recipe.edges.map((edge) => ({
                ...edge,
                asset: { ...edge.asset, revision: String(entry.generation) },
              })),
            },
          }
        : entry.native.document;
    if (entry.kind === "mask") {
      const mask = await finishResources().documentMaskData(
        document,
        entry.native.host,
        entry.controller.signal,
      );
      entry.controller.signal.throwIfAborted();
      if (
        artwork.revision !== entry.revision ||
        (image ? image.naturalWidth : resource.width) !== entry.width ||
        (image ? image.naturalHeight : resource.height) !== entry.height ||
        (image ? image.currentSrc || image.src : "") !== entry.imageUrl
      )
        throw new Error("Card artwork changed before its finish mask was generated");
      entry.texture = new Texture({
        source: new BufferImageSource({
          resource: mask.data,
          width: mask.width,
          height: mask.height,
          format: "r8unorm",
          alphaMode: "no-premultiply-alpha",
          scaleMode: "linear",
          addressMode: "clamp-to-edge",
          autoGenerateMipmaps: false,
        }),
      });
      entry.bytes = mask.data.byteLength;
      preparationStats.masks++;
      preparationStats.preparedUploadBytes += mask.data.byteLength;
      return entry.texture;
    }
    const canvas = await finishResources().documentCoverage(
      document,
      entry.native.host,
      entry.controller.signal,
    );
    try {
      entry.controller.signal.throwIfAborted();
      if (
        artwork.revision !== entry.revision ||
        (image ? image.naturalWidth : resource.width) !== entry.width ||
        (image ? image.naturalHeight : resource.height) !== entry.height ||
        (image ? image.currentSrc || image.src : "") !== entry.imageUrl
      ) {
        throw new Error("Card artwork changed before its finish mask was generated");
      }
      entry.texture = canvasTexture(canvas);
      entry.canvas = canvas;
      entry.bytes = canvas.width * canvas.height * MASK_BYTES_PER_PIXEL;
      preparationStats.coverage++;
      preparationStats.preparedUploadBytes += entry.bytes;
      return entry.texture;
    } catch (error) {
      canvas.width = canvas.height = 0;
      throw error;
    }
  }
  const scale = Math.min(1, MAX_MASK_EDGE / Math.max(width, height));
  const maskWidth = Math.max(1, Math.round(width * scale));
  const maskHeight = Math.max(1, Math.round(height * scale));
  let resized: HTMLCanvasElement | null = null;
  try {
    let input: ArtworkSource = resource;
    if (scale < 1) {
      resized = document.createElement("canvas");
      resized.width = maskWidth;
      resized.height = maskHeight;
      const context = resized.getContext("2d");
      if (!context) throw new Error("Card finish mask resizing requires a 2D canvas context");
      context.drawImage(input, 0, 0, maskWidth, maskHeight);
      input = resized;
    }
    entry.canvas = finishResources().mask(input, maskWidth, maskHeight);
    entry.texture = canvasTexture(entry.canvas);
    entry.bytes = maskWidth * maskHeight * MASK_BYTES_PER_PIXEL;
    preparationStats.masks++;
    preparationStats.preparedUploadBytes += entry.bytes;
    return entry.texture;
  } finally {
    if (resized) {
      resized.width = 1;
      resized.height = 1;
    }
  }
}

function acquireFinishTexture(
  texture: Texture,
  kind: "printing",
  signal?: AbortSignal,
  printDots?: CardCosmetics["printDots"],
  coverage?: CardCosmetics["finishCoverage"],
  optical?: boolean,
  artWindows?: readonly CardFoilRegion[],
): Promise<CardFinishMaskLease | null>;
function acquireFinishTexture(
  texture: Texture,
  kind: "mask" | "coverage",
  signal?: AbortSignal,
  printDots?: CardCosmetics["printDots"],
  coverage?: CardCosmetics["finishCoverage"],
  optical?: boolean,
  artWindows?: readonly CardFoilRegion[],
): Promise<CardFinishMaskLease>;
async function acquireFinishTexture(
  texture: Texture,
  kind: MaskEntry["kind"],
  signal?: AbortSignal,
  printDots?: CardCosmetics["printDots"],
  coverage?: CardCosmetics["finishCoverage"],
  optical = false,
  artWindows: readonly CardFoilRegion[] = [],
): Promise<CardFinishMaskLease | null> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Card finish mask acquisition cancelled", "AbortError");
  }
  if (texture.destroyed || !texture.source || texture.source.destroyed) {
    throw new Error("Cannot generate a finish mask for a destroyed card texture");
  }
  const source = texture.source;
  const resource: unknown = kind === "printing" ? source : source.resource;
  if (!(resource instanceof TextureSource) && !isArtworkSource(resource)) {
    throw new Error("Card finish masks require drawable image, bitmap, or canvas artwork");
  }
  const drawable = resource instanceof TextureSource ? resource.resource : resource;
  const image = isImage(drawable) ? drawable : null;
  const width =
    resource instanceof TextureSource
      ? resource.pixelWidth
      : image
        ? image.naturalWidth
        : resource.width;
  const height =
    resource instanceof TextureSource
      ? resource.pixelHeight
      : image
        ? image.naturalHeight
        : resource.height;
  if (!width || !height || (image && !image.complete)) {
    throw new Error("Card artwork must be loaded before generating a finish mask");
  }
  let native = kind === "printing" ? null : getCardFinishSource(texture, optical);
  if (kind === "coverage") {
    const base: CardDocument = native?.document ?? {
      id: 0,
      revision: 0,
      recipe: {
        pack: "manabrew-raster",
        color: {
          key: "manabrew-raster-coverage",
          size: [width, height],
          async paint(_host, rasterSignal) {
            rasterSignal.throwIfAborted();
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            return canvas;
          },
        },
        edges: [],
        artWindows: artWindows.map(({ x, y, width, height }) => [x, y, width, height]),
        cornerRadius: 0.035,
        regions: [],
      },
    };
    native = {
      kind: native?.kind ?? "raster",
      key: JSON.stringify([native?.key, coverage, artWindows]),
      document: cardFinishCoverageDocument(base, coverage),
      host: native?.host ?? {
        async images(_requests, rasterSignal) {
          rasterSignal.throwIfAborted();
          return { value: new Map<string, ImageBitmap>(), release() {} };
        },
      },
    };
  }
  let artwork = artworkMasks.get(resource);
  if (!artwork) {
    artwork = {
      resource,
      revision: 0,
      sources: new Map(),
      entries: new Map(),
      overflow: new Set(),
    };
    artworkMasks.set(resource, artwork);
  }
  watchSource(artwork, source);
  const url = image ? image.currentSrc || image.src : "";
  const key = JSON.stringify([
    SDK_REVISION,
    kind,
    printDots,
    width,
    height,
    source.pixelWidth,
    source.pixelHeight,
    source.alphaMode,
    source.format,
    artwork.revision,
    url,
    native?.key,
    artWindows,
  ]);
  let entry = artwork.entries.get(key);
  if (!entry) {
    let reservedBytes = 0;
    if (kind === "printing") {
      if (artwork.overflow.has(key)) {
        preparationStats.procedural++;
        return null;
      }
      reservedBytes = mipBytes(width, height);
      for (const idle of idleMasks) {
        if (printingBytes + reservedBytes <= MAX_PRINTING_BYTES) break;
        if (idle.kind === "printing") destroyMask(idle);
      }
      if (printingBytes + reservedBytes > MAX_PRINTING_BYTES) {
        artwork.overflow.add(key);
        preparationStats.procedural++;
        return null;
      }
      printingBytes += reservedBytes;
    }
    preparationStats.misses++;
    const pending: MaskEntry = {
      artwork,
      key,
      revision: artwork.revision,
      generation: ++maskGeneration,
      imageUrl: url,
      width,
      height,
      bytes: 0,
      refs: 0,
      texture: null,
      canvas: null,
      ready: Promise.resolve().then(() => createMask(pending)),
      disposed: false,
      controller: new AbortController(),
      native,
      kind,
      source,
      printDots,
      artWindows,
      reservedBytes,
    };
    artwork.entries.set(key, pending);
    liveMasks.add(pending);
    entry = pending;
  } else {
    preparationStats.hits++;
  }
  const mask = entry;
  removeIdleMask(mask);
  mask.refs += 1;
  leaseCount += 1;
  return new Promise<CardFinishMaskLease>((resolve, reject) => {
    let settled = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseMask(mask);
    };
    const detach = () => {
      signal?.removeEventListener("abort", abort);
      texture.off("destroy", destroyed);
      source.off("destroy", destroyed);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      detach();
      release();
      reject(error);
    };
    const abort = () => {
      fail(
        signal?.reason ?? new DOMException("Card finish mask acquisition cancelled", "AbortError"),
      );
    };
    const destroyed = () => {
      fail(new Error("Card texture was destroyed before its finish mask was acquired"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    texture.once("destroy", destroyed);
    source.once("destroy", destroyed);
    void mask.ready.then((maskTexture) => {
      if (settled) return;
      settled = true;
      detach();
      resolve({ texture: maskTexture, release });
    }, fail);
  });
}

export function acquireCardFinishMask(
  texture: Texture,
  signal?: AbortSignal,
): Promise<CardFinishMaskLease> {
  return acquireFinishTexture(texture, "mask", signal);
}

export async function acquireCardFinishPrinting(
  texture: Texture,
  settings: NonNullable<CardCosmetics["printDots"]>,
  signal?: AbortSignal,
  artWindows: readonly CardFoilRegion[] = [],
): Promise<CardFinishPrintingLease> {
  const normalized = {
    amount: settings.amount,
    period: settings.period ?? DEFAULT_PRINT_DOTS.period,
    variation: settings.variation ?? DEFAULT_PRINT_DOTS.variation,
    inset: settings.inset ?? DEFAULT_PRINT_DOTS.inset,
    ...(settings.artwork === false ? { artwork: false } : {}),
  };
  const lease = await acquireFinishTexture(
    texture,
    "printing",
    signal,
    normalized,
    undefined,
    false,
    artWindows,
  );
  if (lease) return { ...lease, procedural: false };
  return { texture: null, procedural: true, release() {} };
}

export function acquireCardFinishCoverage(
  texture: Texture,
  settings: CardCosmetics["finishCoverage"],
  optical: boolean,
  artWindows: readonly CardFoilRegion[],
  signal?: AbortSignal,
): Promise<CardFinishMaskLease> {
  return acquireFinishTexture(
    texture,
    "coverage",
    signal,
    undefined,
    settings,
    optical,
    artWindows,
  );
}

export function acquireCardFinishCardstock(): CardFinishMaskLease {
  if (!cardstock) {
    try {
      cardstock = { texture: gpuTexture(1, 1, {}), refs: 0 };
    } catch (error) {
      disposeUnusedResources();
      throw error;
    }
  }
  const entry = cardstock;
  entry.refs++;
  leaseCount++;
  let released = false;
  return {
    texture: entry.texture,
    release() {
      if (released) return;
      released = true;
      entry.refs--;
      leaseCount--;
      if (!entry.refs) {
        entry.texture.destroy(true);
        cardstock = null;
      }
      disposeUnusedResources();
    },
  };
}

export function acquireCardFinishCaustics(): CardFinishCausticsLease {
  if (!caustics) {
    try {
      caustics = { texture: canvasTexture(finishResources().caustics(0), true), refs: 0, time: 0 };
    } catch (error) {
      disposeUnusedResources();
      throw error;
    }
  }
  const entry = caustics;
  entry.refs += 1;
  leaseCount += 1;
  let released = false;
  return {
    texture: entry.texture,
    update(time) {
      if (released || entry.time === time) return;
      finishResources().caustics(time);
      entry.texture.source.update();
      preparationStats.dynamicUpdates++;
      entry.time = time;
    },
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      leaseCount -= 1;
      if (!entry.refs) {
        entry.texture.destroy(true);
        caustics = null;
      }
      disposeUnusedResources();
    },
  };
}
