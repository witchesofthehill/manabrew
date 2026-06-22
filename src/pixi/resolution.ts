import type { Application } from "pixi.js";

export function pixiResolution(): number {
  return window.devicePixelRatio || 1;
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
