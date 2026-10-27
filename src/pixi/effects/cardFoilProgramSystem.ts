import {
  defaultValue,
  extensions,
  extractAttributesFromGlProgram,
  getUboData,
  getUniformData,
  GlProgramData,
  GlShaderSystem,
  type GlProgram,
  type GlRenderingContext,
} from "pixi.js";

interface PendingProgram {
  program: WebGLProgram;
  shaders: WebGLShader[];
  callbacks: Set<() => void>;
  timer: number | undefined;
  data?: GlProgramData;
  error?: Error;
}

export class CardFoilProgramSystem extends GlShaderSystem {
  private readonly programs = new Map<number, PendingProgram>();
  private readonly lost = () => {
    for (const entry of this.programs.values()) {
      window.clearTimeout(entry.timer);
      entry.data?.destroy();
      for (const callback of entry.callbacks) callback();
    }
    this.programs.clear();
  };
  private parallel: KHR_parallel_shader_compile | null = null;

  protected override contextChange(gl: GlRenderingContext): void {
    this._gl?.canvas.removeEventListener("webglcontextlost", this.lost);
    this.clearPrograms();
    super.contextChange(gl);
    gl.canvas.addEventListener("webglcontextlost", this.lost);
    this.parallel = gl.getExtension("KHR_parallel_shader_compile");
  }

  ready(source: GlProgram, invalidate: () => void): boolean {
    let pending = this.programs.get(source._key);
    if (pending?.error) throw pending.error;
    if (pending?.data) return true;
    if (pending) {
      pending.callbacks.add(invalidate);
      return false;
    }
    const gl = this._gl;
    if (gl.isContextLost()) return false;
    const program = gl.createProgram();
    if (!program) throw new Error("Card finish program allocation failed");
    pending = { program, shaders: [], callbacks: new Set([invalidate]), timer: undefined };
    this.programs.set(source._key, pending);
    try {
      for (const [type, code] of [
        [gl.VERTEX_SHADER, source.vertex],
        [gl.FRAGMENT_SHADER, source.fragment],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Card finish shader allocation failed");
        pending.shaders.push(shader);
        gl.shaderSource(shader, code!);
        gl.compileShader(shader);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
    } catch (error) {
      this.deleteProgram(pending);
      this.programs.delete(source._key);
      throw error;
    }
    const entry = pending;
    const poll = () => {
      entry.timer = undefined;
      if (gl.isContextLost() || this.programs.get(source._key) !== entry) return;
      if (this.parallel && !gl.getProgramParameter(program, this.parallel.COMPLETION_STATUS_KHR)) {
        entry.timer = window.setTimeout(poll, 8);
        return;
      }
      try {
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const logs = entry.shaders.map((shader) => gl.getShaderInfoLog(shader)).filter(Boolean);
          throw new Error(
            [gl.getProgramInfoLog(program), ...logs].filter(Boolean).join("\n") ||
              "Card finish program linking failed",
          );
        }
        source._attributeData = extractAttributesFromGlProgram(program, gl, false);
        source._uniformData = getUniformData(program, gl);
        source._uniformBlockData = getUboData(program, gl);
        const uniforms: GlProgramData["uniformData"] = {};
        for (const [name, data] of Object.entries(source._uniformData)) {
          uniforms[name] = {
            location: gl.getUniformLocation(program, name),
            value: defaultValue(data.type, data.size),
          };
        }
        entry.data = new GlProgramData(program, uniforms);
      } catch (error) {
        entry.error = error instanceof Error ? error : new Error(String(error));
        gl.deleteProgram(program);
      } finally {
        for (const shader of entry.shaders) gl.deleteShader(shader);
        entry.shaders.length = 0;
      }
      const callbacks = [...entry.callbacks];
      entry.callbacks.clear();
      for (const callback of callbacks) callback();
    };
    entry.timer = window.setTimeout(poll, 0);
    return false;
  }

  override _getProgramData(program: GlProgram): GlProgramData {
    const pending = this.programs.get(program._key);
    if (!pending) return super._getProgramData(program);
    if (pending.error) throw pending.error;
    if (!pending.data) throw new Error("Card finish program is not ready");
    return pending.data;
  }

  private deleteProgram(entry: PendingProgram): void {
    window.clearTimeout(entry.timer);
    for (const shader of entry.shaders) this._gl.deleteShader(shader);
    this._gl.deleteProgram(entry.program);
    entry.data?.destroy();
    entry.callbacks.clear();
  }

  private clearPrograms(): void {
    for (const entry of this.programs.values()) this.deleteProgram(entry);
    this.programs.clear();
  }

  override destroy(): void {
    this._gl?.canvas.removeEventListener("webglcontextlost", this.lost);
    this.clearPrograms();
    super.destroy();
  }
}

extensions.remove(GlShaderSystem);
extensions.add(CardFoilProgramSystem);
