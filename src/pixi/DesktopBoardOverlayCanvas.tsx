import type { Application } from "pixi.js";

import { BoardOverlayCanvasSurface, type BoardOverlayCanvasProps } from "./BoardOverlayCanvas";
import { DesktopPromptLayer } from "./prompts/DesktopPromptLayer";
import type { PromptLayer } from "./prompts/PromptLayer";
import type { PromptLayerCallbacks } from "./prompts/prompt.types";

function createDesktopPromptLayer(app: Application, callbacks: PromptLayerCallbacks): PromptLayer {
  return new DesktopPromptLayer(app, callbacks);
}

export function DesktopBoardOverlayCanvas(props: BoardOverlayCanvasProps) {
  return <BoardOverlayCanvasSurface {...props} createPromptLayer={createDesktopPromptLayer} />;
}
