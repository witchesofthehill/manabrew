import {
  BufferImageSource,
  extensions,
  ExtensionType,
  Mesh,
  Shader,
  Texture,
  UniformGroup,
  type InstructionSet,
  type MeshGeometry,
  type WebGLRenderer,
} from "pixi.js";
import type { CardFoilShader, CardFoilTextureRole } from "./cardFoilShader";
import {
  CARD_FOIL_DATA_TEXELS,
  CARD_FOIL_INSTANCE_FIELDS,
  CARD_FOIL_SHARED_FIELDS,
  CARD_FOIL_TRANSFORM_OFFSET,
  getCardFoilProgram,
} from "./cardFoilPrograms";
import {
  CardFoilTextureArrays,
  cardFoilBatchCounters,
  type CardFoilArrayLease,
} from "./cardFoilTextureArrays";
import {
  createCardGpuTimer,
  getCardGpuTimingStats,
  type CardGpuTimer,
} from "@/lib/cardRenderGpuTiming";

const MAX_INSTANCES = 32;
const MIN_BATCH_VARYING_VECTORS = 12;
const ROLES: readonly CardFoilTextureRole[] = ["face", "mask", "printing", "coverage"];
export function getCardFoilBatchStats() {
  const gpuTiming = getCardGpuTimingStats("pixi");
  return {
    ...cardFoilBatchCounters,
    gpuTiming,
    gpuTimingAvailable: gpuTiming.gpuTimingAvailable,
    gpuCompletionMs: gpuTiming.gpuCompletionMs,
  };
}
export class CardFoilMesh extends Mesh<MeshGeometry, Shader> {
  override readonly renderPipeId = "cardFoil";
  finish: CardFoilShader;
  readonly presentation: "board" | "dom";
  constructor(finish: CardFoilShader, presentation: "board" | "dom" = "board") {
    super({ geometry: finish.geometry, shader: finish.shader });
    this.finish = finish;
    this.presentation = presentation;
  }
}
interface MeshResidency {
  sources: Texture["source"][];
  leases: CardFoilArrayLease[];
  used: number;
  dispose: () => void;
}
interface BatchInstruction {
  renderPipeId: "cardFoil";
  canBundle: false;
  meshes: CardFoilMesh[];
  draws: DrawData[];
  used: number;
}
interface DrawData {
  source: BufferImageSource;
  data: Float32Array;
  rows: Float32Array[];
  dirty: boolean[];
  uploaded: boolean;
}

function sameSharedUniforms(
  first: CardFoilShader["uniforms"],
  other: CardFoilShader["uniforms"],
): boolean {
  for (const [name, size] of CARD_FOIL_SHARED_FIELDS) {
    const value = first[name];
    const next = other[name];
    if (typeof value === "number" || typeof next === "number") {
      if (value !== next) return false;
    } else {
      for (let component = 0; component < size; component++)
        if (value[component] !== next[component]) return false;
    }
  }
  return true;
}

class CardFoilPipe {
  static extension = { type: ExtensionType.WebGLPipes, name: "cardFoil" } as const;
  private readonly arrays: CardFoilTextureArrays;
  private readonly residency = new Map<CardFoilMesh, MeshResidency>();
  private readonly shaders = new Map<number, Shader>();
  private readonly instructions = new Set<BatchInstruction>();
  private readonly gpuTimers: Partial<Record<CardFoilMesh["presentation"], CardGpuTimer>> = {};
  private readonly resetGpuTiming = () => {
    this.gpuTimers.board?.reset();
    this.gpuTimers.dom?.reset();
  };
  private supported: boolean | undefined;
  private readonly restore = () => {
    this.resetGpuTiming();
    this.supported = undefined;
    for (const instruction of this.instructions)
      for (const draw of instruction.draws) draw.uploaded = false;
  };
  private epoch = 0;
  private readonly transformData = new Float32Array(16);

  private readonly renderer: WebGLRenderer;
  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.arrays = new CardFoilTextureArrays(renderer);
    renderer.runners.renderStart.add(this);
    renderer.runners.renderEnd.add(this);
    renderer.runners.init.add(this);
  }

  init(): void {
    this.arrays.init();
    this.renderer.canvas.addEventListener("webglcontextlost", this.resetGpuTiming);
    this.renderer.canvas.addEventListener("webglcontextrestored", this.restore);
  }

  addRenderable(mesh: CardFoilMesh, instructionSet: InstructionSet): void {
    this.renderer.renderPipes.batch.break(instructionSet);
    const previous = instructionSet.instructions[instructionSet.instructionSize - 1] as
      | BatchInstruction
      | undefined;
    if (previous?.renderPipeId === "cardFoil" && previous.meshes) previous.meshes.push(mesh);
    else {
      const instruction: BatchInstruction = {
        renderPipeId: "cardFoil",
        canBundle: false,
        meshes: [mesh],
        draws: [],
        used: this.epoch,
      };
      this.instructions.add(instruction);
      instructionSet.add(instruction);
      cardFoilBatchCounters.boundaries++;
    }
  }
  renderStart(): void {
    if (this.renderer.gl.isContextLost()) return;
    this.epoch++;
    const renderer = this.renderer;
    const gl = renderer.gl as WebGL2RenderingContext;
    this.supported ??=
      renderer.context.webGLVersion === 2 &&
      gl.getParameter(gl.MAX_VARYING_VECTORS) >= MIN_BATCH_VARYING_VECTORS &&
      gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0 &&
      gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 8;
  }
  renderEnd(): void {
    if (this.renderer.gl.isContextLost()) return;
    for (const resident of this.residency.values())
      if (resident.used !== this.epoch) resident.dispose();
    for (const instruction of this.instructions) {
      if (instruction.used === this.epoch) continue;
      for (const draw of instruction.draws) draw.source.destroy();
      instruction.draws.length = 0;
      this.instructions.delete(instruction);
    }
  }
  validateRenderable(): boolean {
    return false;
  }
  updateRenderable(): void {}
  destroyRenderable(mesh: CardFoilMesh): void {
    const resident = this.residency.get(mesh);
    resident?.dispose();
  }

  private getResidency(mesh: CardFoilMesh): MeshResidency | null {
    let resident = this.residency.get(mesh);
    let unchanged = !!resident;
    for (let index = 0; unchanged && index < ROLES.length; index++) {
      const texture = mesh.finish.textures[ROLES[index]];
      unchanged =
        resident!.leases[index].valid &&
        resident!.sources[index] ===
          (texture === Texture.EMPTY ? Texture.WHITE.source : texture.source);
    }
    if (resident && unchanged) {
      resident.used = this.epoch;
      return resident;
    }
    resident?.dispose();
    const sources = ROLES.map((role) =>
      mesh.finish.textures[role] === Texture.EMPTY
        ? Texture.WHITE.source
        : mesh.finish.textures[role].source,
    );
    const leases: CardFoilArrayLease[] = [];
    for (let index = 0; index < sources.length; index++) {
      const lease = this.arrays.acquire(sources[index], index === 0 || index === 2);
      if (!lease) {
        for (const acquired of leases) acquired.release();
        return null;
      }
      leases.push(lease);
    }
    const dispose = () => {
      mesh.off("destroyed", dispose);
      for (const lease of leases) lease.release();
      this.residency.delete(mesh);
    };
    resident = { sources, leases, dispose, used: this.epoch };
    mesh.once("destroyed", dispose);
    this.residency.set(mesh, resident);
    return resident;
  }

  private createDraw(): DrawData {
    const data = new Float32Array(CARD_FOIL_DATA_TEXELS * 4 * MAX_INSTANCES);
    const rows = Array.from({ length: MAX_INSTANCES }, (_, index) =>
      data.subarray(index * CARD_FOIL_DATA_TEXELS * 4, (index + 1) * CARD_FOIL_DATA_TEXELS * 4),
    );
    return {
      data,
      rows,
      dirty: Array<boolean>(MAX_INSTANCES).fill(true),
      uploaded: false,
      source: new BufferImageSource({
        resource: data,
        width: CARD_FOIL_DATA_TEXELS,
        height: MAX_INSTANCES,
        format: "rgba32float",
        scaleMode: "nearest",
        alphaMode: "no-premultiply-alpha",
        autoGarbageCollect: false,
      }),
    };
  }

  execute(instruction: BatchInstruction): void {
    if (this.renderer.gl.isContextLost()) return;
    const presentation = instruction.meshes[0]?.presentation;
    const timer = presentation
      ? (this.gpuTimers[presentation] ??= createCardGpuTimer(
          this.renderer.gl as WebGL2RenderingContext,
          presentation === "board" ? "pixi" : "dom",
        ))
      : undefined;
    timer?.begin();
    try {
      this.drawMaterials(instruction);
    } finally {
      timer?.end();
    }
  }

  private drawMaterials(instruction: BatchInstruction): void {
    const renderer = this.renderer;
    const gl = renderer.gl as WebGL2RenderingContext;
    instruction.used = this.epoch;
    this.instructions.add(instruction);
    let first = 0;
    let drawIndex = 0;
    while (first < instruction.meshes.length) {
      const mesh = instruction.meshes[first];
      if (!mesh.isRenderable) {
        first++;
        continue;
      }
      const finish = mesh.finish;
      const resident =
        this.supported && instruction.meshes.length > 1 && finish.artWindowCount <= 2
          ? this.getResidency(mesh)
          : null;
      if (!resident) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        renderer.renderPipes.mesh.execute(mesh as unknown as Mesh);
        if (mesh.presentation === "dom") cardFoilBatchCounters.domDraws++;
        else {
          cardFoilBatchCounters.draws++;
          cardFoilBatchCounters.fallbackDraws++;
        }
        first++;
        continue;
      }
      const procedural =
        finish.uniforms.faceProcedural > 0 || finish.uniforms.printingProcedural > 0;
      const lighting = finish.uniforms.studioLighting;
      const time = finish.uniforms.surfaceTime;
      const cardstock = finish.shader.resources.cardstockMap;
      const caustics = finish.shader.resources.caustics;
      const draw = (instruction.draws[drawIndex] ??= this.createDraw());
      drawIndex++;
      let count = 0;
      let cursor = first;
      while (cursor < instruction.meshes.length && count < MAX_INSTANCES) {
        const next = instruction.meshes[cursor];
        if (!next.isRenderable) {
          cursor++;
          continue;
        }
        const other = next.finish;
        if (
          other.artWindowCount > 2 ||
          other.uniforms.studioLighting !== lighting ||
          other.uniforms.surfaceTime !== time ||
          (other.uniforms.faceProcedural > 0 || other.uniforms.printingProcedural > 0) !==
            procedural ||
          other.shader.resources.cardstockMap !== cardstock ||
          other.shader.resources.caustics !== caustics ||
          next.groupBlendMode !== mesh.groupBlendMode ||
          (other !== finish && !sameSharedUniforms(finish.uniforms, other.uniforms))
        )
          break;
        const nextResident = this.getResidency(next);
        if (
          !nextResident ||
          !nextResident.leases.every((lease, index) => lease.page === resident.leases[index].page)
        )
          break;
        const row = draw.rows[count];
        let offset = 0;
        let changed = false;
        for (const [name, size] of CARD_FOIL_INSTANCE_FIELDS) {
          const value = other.uniforms[name];
          const activeSize = name === "uExclusions" ? other.uniforms.uExclusionCount * 4 : size;
          for (let component = 0; component < activeSize; component++) {
            const number = typeof value === "number" ? value : value[component];
            const rounded = Math.fround(number);
            if (row[offset + component] !== rounded) {
              row[offset + component] = rounded;
              changed = true;
            }
          }
          offset += Math.ceil(size / 4) * 4;
        }
        const transform = next.groupTransform;
        const alpha = ((next.groupColorAlpha >>> 24) & 255) / 255;
        const values = this.transformData;
        values[0] = transform.a;
        values[1] = transform.b;
        values[2] = transform.c;
        values[3] = transform.d;
        values[4] = transform.tx;
        values[5] = transform.ty;
        for (let index = 0; index < 4; index++)
          values[8 + index] = nextResident.leases[index].layer;
        values[12] = values[13] = values[14] = 1;
        values[15] = alpha;
        offset = CARD_FOIL_TRANSFORM_OFFSET * 4;
        for (let component = 0; component < values.length; component++) {
          const value = values[component];
          if (row[offset + component] !== value) {
            row[offset + component] = value;
            changed = true;
          }
        }
        draw.dirty[count] ||= changed;
        count++;
        cursor++;
      }
      for (const lease of resident.leases) this.arrays.upload(lease.page);
      if (draw.uploaded) {
        for (let row = 0; row < count; row++) {
          if (!draw.dirty[row]) continue;
          renderer.texture.resetState();
          break;
        }
      }
      renderer.texture.bindSource(draw.source, 0);
      if (!draw.uploaded) {
        draw.uploaded = true;
        draw.dirty.fill(false);
        cardFoilBatchCounters.instanceUpdates += count;
        cardFoilBatchCounters.instanceUploadBytes += draw.data.byteLength;
      } else {
        const texture = renderer.texture.getGlSource(draw.source);
        for (let row = 0; row < count; row++) {
          if (!draw.dirty[row]) continue;
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            row,
            CARD_FOIL_DATA_TEXELS,
            1,
            texture.format,
            texture.type,
            draw.rows[row],
          );
          draw.dirty[row] = false;
          cardFoilBatchCounters.instanceUpdates++;
          cardFoilBatchCounters.instanceUploadBytes += draw.rows[row].byteLength;
        }
      }
      const key = lighting * 4 + (procedural ? 2 : 0) + (time === 0 ? 1 : 0);
      let shader = this.shaders.get(key);
      if (!shader) {
        shader = new Shader({
          glProgram: getCardFoilProgram(true, procedural),
          resources: {
            frameUniforms: new UniformGroup(
              {
                surfaceTime: { value: time, type: "f32" },
                studioLighting: { value: lighting, type: "f32" },
                hasWave: { value: 0, type: "f32" },
                satinCompact: { value: 1, type: "f32" },
                satinHoverGain: { value: 0, type: "f32" },
                facePixelSize: { value: new Float32Array(2), type: "vec2<f32>" },
                previewKind: { value: 0, type: "f32" },
                hasMask: { value: 0, type: "f32" },
                aspect: { value: 0, type: "f32" },
                pointer: { value: new Float32Array(2), type: "vec2<f32>" },
                surfaceInfo: { value: new Float32Array(4), type: "vec4<f32>" },
                ripple0: { value: new Float32Array(4), type: "vec4<f32>" },
                ripple1: { value: new Float32Array(4), type: "vec4<f32>" },
                ripple2: { value: new Float32Array(4), type: "vec4<f32>" },
                ripple3: { value: new Float32Array(4), type: "vec4<f32>" },
                rainFogDensity: { value: 0, type: "f32" },
                heatDeformation: { value: 0, type: "f32" },
                cardstockAmount: { value: 0, type: "f32" },
                printDotsInfo: { value: new Float32Array(4), type: "vec4<f32>" },
                artBounds: { value: new Float32Array(4), type: "vec4<f32>" },
                artBounds2: { value: new Float32Array(4), type: "vec4<f32>" },
              },
              { isStatic: false },
            ),
            instanceData: draw.source,
            faces: resident.leases[0].page.source,
            masks: resident.leases[1].page.source,
            printings: resident.leases[2].page.source,
            coverages: resident.leases[3].page.source,
            cardstockMap: cardstock,
            caustics,
          },
        });
        this.shaders.set(key, shader);
      }
      const frame = shader.resources.frameUniforms as UniformGroup;
      frame.uniforms.surfaceTime = time;
      for (const [name, size] of CARD_FOIL_SHARED_FIELDS) {
        const value = finish.uniforms[name];
        if (typeof value === "number") {
          if (frame.uniforms[name] !== value) {
            frame.uniforms[name] = value;
          }
        } else {
          for (let component = 0; component < size; component++) {
            const target = (
              component < 4 ? frame.uniforms[name] : frame.uniforms.artBounds2
            ) as Float32Array;
            const index = component < 4 ? component : component - 4;
            if (target[index] !== value[component]) {
              target[index] = value[component];
            }
          }
        }
      }
      shader.resources.instanceData = draw.source;
      shader.resources.faces = resident.leases[0].page.source;
      shader.resources.masks = resident.leases[1].page.source;
      shader.resources.printings = resident.leases[2].page.source;
      shader.resources.coverages = resident.leases[3].page.source;
      shader.resources.cardstockMap = cardstock;
      shader.resources.caustics = caustics;
      shader.groups[100] = renderer.globalUniforms.bindGroup;
      mesh.state.blendMode = mesh.groupBlendMode;
      renderer.encoder.draw({
        geometry: finish.geometry,
        shader,
        state: mesh.state,
        instanceCount: count,
      });
      shader.resources.instanceData =
        shader.resources.faces =
        shader.resources.masks =
        shader.resources.printings =
        shader.resources.coverages =
        shader.resources.cardstockMap =
        shader.resources.caustics =
          Texture.EMPTY.source;
      if (mesh.presentation === "dom") cardFoilBatchCounters.domDraws++;
      else {
        cardFoilBatchCounters.draws++;
        cardFoilBatchCounters.batches++;
        cardFoilBatchCounters.instances += count;
      }
      first = cursor;
    }
  }

  destroy(): void {
    this.renderer.canvas.removeEventListener("webglcontextlost", this.resetGpuTiming);
    this.gpuTimers.board?.destroy();
    this.gpuTimers.dom?.destroy();
    this.renderer.canvas.removeEventListener("webglcontextrestored", this.restore);
    this.renderer.runners.renderStart.remove(this);
    this.renderer.runners.renderEnd.remove(this);
    this.renderer.runners.init.remove(this);
    for (const resident of this.residency.values()) resident.dispose();
    for (const instruction of this.instructions)
      for (const draw of instruction.draws) draw.source.destroy();
    for (const shader of this.shaders.values()) shader.destroy(false);
    this.arrays.destroy();
    this.instructions.clear();
    this.shaders.clear();
  }
}
extensions.add(CardFoilPipe);
