import { TextureSource, type WebGLRenderer } from "pixi.js";

export const CARD_FOIL_PAGE_BUDGET = 64 * 1024 * 1024;
const PAGE_LAYERS = 4;
export const cardFoilBatchCounters = {
  draws: 0,
  batches: 0,
  instances: 0,
  fallbackDraws: 0,
  boundaries: 0,
  allocatedPageBytes: 0,
  activePageBytes: 0,
  idlePageBytes: 0,
  staticUploads: 0,
  staticUploadBytes: 0,
  instanceUpdates: 0,
  instanceUploadBytes: 0,
  restores: 0,
  domDraws: 0,
};
interface Resident {
  key: string;
  source: TextureSource;
  page: CardFoilArrayPage;
  layer: number;
  references: number;
  dirty: boolean;
  update: () => void;
  destroy: () => void;
}
export interface CardFoilArrayPage {
  key: string;
  source: TextureSource;
  residents: (Resident | null)[];
  bytes: number;
  allocated: boolean;
}
export interface CardFoilArrayLease {
  page: CardFoilArrayPage;
  layer: number;
  readonly valid: boolean;
  release(): void;
}

export class CardFoilTextureArrays {
  private readonly pages: CardFoilArrayPage[] = [];
  private readonly residents = new Map<string, Resident>();
  private bytes = 0;
  private copyFramebuffer: WebGLFramebuffer | null = null;
  private readonly restore = () => {
    cardFoilBatchCounters.restores++;
    this.copyFramebuffer = null;
    for (const page of this.pages) {
      page.allocated = false;
      for (const resident of page.residents) if (resident) resident.dirty = true;
    }
  };

  private readonly renderer: WebGLRenderer;
  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  init(): void {
    this.renderer.canvas.addEventListener("webglcontextrestored", this.restore);
  }

  acquire(source: TextureSource, mipmaps: boolean): CardFoilArrayLease | null {
    const residentKey = `${source.uid}:${mipmaps}`;
    let resident = this.residents.get(residentKey);
    if (!resident) {
      if (source.destroyed || !source.resource || source.pixelWidth < 1 || source.pixelHeight < 1)
        return null;
      const r8 = source.format === "r8unorm";
      if (!r8 && source.format !== "rgba8unorm" && source.format !== "bgra8unorm") return null;
      const key = `${source.pixelWidth}:${source.pixelHeight}:${source.format}:${source.alphaMode}:${mipmaps ? "trilinear" : "linear"}`;
      let page = this.pages.find(
        (candidate) => candidate.key === key && candidate.residents.some((slot) => slot === null),
      );
      if (!page) {
        const width = source.pixelWidth;
        const height = source.pixelHeight;
        const pagePixelBytes = (r8 ? 1 : 4) * PAGE_LAYERS;
        let w = width;
        let h = height;
        let bytes = w * h * pagePixelBytes;
        while (mipmaps && (w > 1 || h > 1)) {
          w = Math.max(1, Math.floor(w / 2));
          h = Math.max(1, Math.floor(h / 2));
          bytes += w * h * pagePixelBytes;
        }
        for (const candidate of [...this.pages]) {
          if (this.bytes + bytes <= CARD_FOIL_PAGE_BUDGET) break;
          if (candidate.residents.every((slot) => !slot || slot.references === 0))
            this.removePage(candidate);
        }
        if (this.bytes + bytes > CARD_FOIL_PAGE_BUDGET) return null;
        page = {
          key,
          bytes,
          allocated: false,
          residents: Array<Resident | null>(PAGE_LAYERS).fill(null),
          source: new TextureSource({
            width,
            height,
            format: source.format,
            viewDimension: "2d-array",
            arrayLayerCount: PAGE_LAYERS,
            alphaMode: "no-premultiply-alpha",
            autoGenerateMipmaps: mipmaps,
            scaleMode: "linear",
            minFilter: "linear",
            magFilter: "linear",
            mipmapFilter: "linear",
            addressMode: "clamp-to-edge",
            autoGarbageCollect: false,
          }),
        };
        this.pages.push(page);
        this.bytes += bytes;
        cardFoilBatchCounters.allocatedPageBytes += bytes;
      }
      const layer = page.residents.findIndex((slot) => slot === null);
      const entry: Resident = {
        key: residentKey,
        source,
        page,
        layer,
        references: 0,
        dirty: true,
        update: () => {
          entry.dirty = true;
        },
        destroy: () => {
          this.removeResident(entry);
        },
      };
      resident = entry;
      page.residents[layer] = entry;
      this.residents.set(residentKey, entry);
      source.on("update", entry.update);
      source.on("destroy", entry.destroy);
      source.on("resize", entry.destroy);
    }
    resident.references++;
    this.updateResidencyBytes();
    let released = false;
    const entry = resident;
    return {
      page: entry.page,
      layer: entry.layer,
      get valid() {
        return entry.page.residents[entry.layer] === entry;
      },
      release: () => {
        if (released) return;
        released = true;
        entry.references--;
        this.updateResidencyBytes();
      },
    };
  }

  upload(page: CardFoilArrayPage): void {
    let pending = !page.allocated;
    for (const entry of page.residents) if (entry?.dirty) pending = true;
    if (!pending) return;
    const renderer = this.renderer;
    const gl = renderer.gl as WebGL2RenderingContext;
    renderer.texture.resetState();
    renderer.texture.bindSource(page.source, 0);
    const texture = renderer.texture.getGlSource(page.source);
    const fresh = !page.allocated;
    page.allocated = true;
    let changed = false;
    for (const entry of page.residents) {
      if (!entry || (!entry.dirty && !fresh) || entry.source.destroyed) continue;
      const source = entry.source;
      const bitmap = typeof ImageBitmap !== "undefined" && source.resource instanceof ImageBitmap;
      if (source.alphaMode === "premultiply-alpha-on-upload" && !bitmap) {
        renderer.texture.resetState();
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
        renderer.texture.bindSource(source, 0);
        this.copyFramebuffer ??= gl.createFramebuffer();
        if (!this.copyFramebuffer)
          throw new Error("Card finish copy framebuffer allocation failed");
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.copyFramebuffer);
        gl.framebufferTexture2D(
          gl.READ_FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_2D,
          renderer.texture.getGlSource(source).texture,
          0,
        );
        renderer.texture.bindSource(page.source, 0);
        gl.copyTexSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          entry.layer,
          0,
          0,
          source.pixelWidth,
          source.pixelHeight,
        );
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
        renderer.texture.resetState();
        renderer.texture.bindSource(page.source, 0);
      } else {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY,
          0,
          0,
          0,
          entry.layer,
          source.pixelWidth,
          source.pixelHeight,
          1,
          texture.format,
          texture.type,
          source.resource as TexImageSource,
        );
      }
      entry.dirty = false;
      changed = true;
      cardFoilBatchCounters.staticUploads++;
      cardFoilBatchCounters.staticUploadBytes +=
        source.pixelWidth * source.pixelHeight * (source.format === "r8unorm" ? 1 : 4);
    }
    if (changed && page.source.autoGenerateMipmaps) gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    renderer.texture.resetState();
    this.updateResidencyBytes();
  }

  private updateResidencyBytes(): void {
    let active = 0;
    for (const page of this.pages)
      if (page.residents.some((entry) => entry && entry.references > 0)) active += page.bytes;
    cardFoilBatchCounters.activePageBytes += active - this.activeBytes;
    cardFoilBatchCounters.idlePageBytes += this.bytes - active - this.idleBytes;
    this.activeBytes = active;
    this.idleBytes = this.bytes - active;
  }
  private activeBytes = 0;
  private idleBytes = 0;

  private removeResident(entry: Resident): void {
    entry.source.off("update", entry.update);
    entry.source.off("destroy", entry.destroy);
    entry.source.off("resize", entry.destroy);
    this.residents.delete(entry.key);
    entry.page.residents[entry.layer] = null;
    this.updateResidencyBytes();
  }

  private removePage(page: CardFoilArrayPage): void {
    for (const entry of page.residents) if (entry) this.removeResident(entry);
    this.renderer.texture.unbind(page.source);
    page.source.destroy();
    this.pages.splice(this.pages.indexOf(page), 1);
    this.bytes -= page.bytes;
    cardFoilBatchCounters.allocatedPageBytes -= page.bytes;
    this.updateResidencyBytes();
  }

  destroy(): void {
    this.renderer.canvas.removeEventListener("webglcontextrestored", this.restore);
    for (const page of [...this.pages]) this.removePage(page);
    if (this.copyFramebuffer) this.renderer.gl.deleteFramebuffer(this.copyFramebuffer);
    this.copyFramebuffer = null;
  }
}
