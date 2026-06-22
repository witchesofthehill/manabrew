import type { Application } from "pixi.js";

function probeMaxTextureSize(): number {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return 0;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof max === "number" ? max : 0;
  } catch {
    return 0;
  }
}

export function pixiResolution(): number {
  const dpr = window.devicePixelRatio || 1;
  const target = Math.max(3, dpr);
  const maxTex = probeMaxTextureSize();
  const maxDim = Math.max(window.screen.width, window.screen.height);
  if (!maxTex || !maxDim) return target;
  return Math.max(dpr, Math.min(target, maxTex / maxDim));
}

export function logPixiResolution(label: string, app: Application): void {
  const renderer = app.renderer as unknown as {
    gl?: WebGL2RenderingContext;
    resolution?: number;
    canvas?: HTMLCanvasElement;
  };
  const gl = renderer.gl;
  const canvas = renderer.canvas;
  console.info(`[pixi] ${label}`, {
    devicePixelRatio: window.devicePixelRatio,
    resolution: renderer.resolution,
    cssSize: canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : "?",
    backingSize: canvas ? `${canvas.width}x${canvas.height}` : "?",
    drawingBuffer: gl ? `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` : "?",
    maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : "?",
    maxRenderbufferSize: gl ? gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) : "?",
  });
}
